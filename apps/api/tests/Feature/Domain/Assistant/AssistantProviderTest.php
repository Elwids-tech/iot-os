<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Assistant;

use App\Domain\Assistant\Jobs\RunAssistant;
use App\Domain\Assistant\Models\AssistantConversation;
use App\Domain\Assistant\Models\AssistantProposal;
use App\Domain\Assistant\Models\AssistantProviderKey;
use App\Domain\Assistant\Models\AssistantSetting;
use App\Domain\Assistant\Services\AssistantProvider;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Laravel\Ai\Enums\Lab;
use Tests\TestCase;

final class AssistantProviderTest extends TestCase
{
    use RefreshDatabase;

    private const ANTHROPIC_KEY = 'sk-ant-test-only-saved-key-4444';

    public function test_the_profile_assistant_runs_on_the_saved_anthropic_provider_through_an_approval_pause(): void
    {
        $this->seed(DatabaseSeeder::class);
        Queue::fake();
        Http::preventStrayRequests();
        config(['assistant.enabled' => true, 'ai.providers.openai.key' => 'sk-environment-openai-key', 'ai.conversations.generate_title' => false]);
        $this->saveAnthropic('claude-sonnet-5-5');
        $org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actingAs(User::where('email', 'shared.operator@example.test')->firstOrFail());
        $base = '/api/v1/organizations/'.$org->uuid.'/assistant/conversations';
        $path = $base.'/'.$this->postJson($base, [])->assertCreated()->json('data.id');
        $count = DeviceProfile::count();
        $step = 0;
        Http::fake(['api.anthropic.com/*' => function ($request) use (&$step) {
            $this->assertTrue($request->hasHeader('x-api-key', self::ANTHROPIC_KEY));
            $this->assertSame('claude-sonnet-5-5', $request['model']);
            $this->assertSame('low', $request['output_config']['effort']);
            $this->assertSame(['type' => 'auto', 'disable_parallel_tool_use' => true], $request['tool_choice']);
            foreach (['store', 'parallel_tool_calls', 'reasoning'] as $openAiOption) {
                $this->assertArrayNotHasKey($openAiOption, $request->data(), "OpenAI's {$openAiOption} option must not reach Anthropic.");
            }
            $calls = [];
            foreach ($request['messages'] as $message) {
                foreach (is_array($message['content']) ? $message['content'] : [] as $block) {
                    if ($block['type'] === 'tool_use') {
                        $calls[] = $block['id'];
                    }
                    if ($block['type'] === 'tool_result') {
                        $this->assertContains($block['tool_use_id'], $calls, 'Every tool result must follow its call, including calls from before the approval pause.');
                    }
                }
            }
            $step++;
            if ($step === 1) {
                return $this->streamTool('ProfileAssistantTools', ['action' => 'preview_section', 'arguments_json' => json_encode(['section' => 'identity', 'summary' => 'Review temperature probe identity', 'changes' => [['operation' => 'upsert', 'values' => ['name' => 'Approved probe', 'code' => 'approved-probe']]]])], 'preview');
            }
            if ($step === 2) {
                $proposal = AssistantProposal::firstOrFail();

                return $this->streamTool('ApplyProfileSection', ['proposal_id' => $proposal->id, 'content_hash' => $proposal->content_hash], 'approval');
            }

            return $this->streamText('Identity saved. What does the probe measure?');
        }]);

        $run = $this->postJson($path.'/messages', ['request_id' => (string) Str::uuid(), 'text' => 'Create Approved probe, code approved-probe'])->assertAccepted()->json('data.id');
        (new RunAssistant($run))->handle();
        $chat = AssistantConversation::findOrFail(Str::afterLast($path, '/'));
        $first = $chat->runs()->findOrFail($run);
        $this->assertSame('awaiting_approval', $first->status, $first->error_message ?? '');
        // Two steps of 1,000 input and 100 output tokens at Claude Sonnet 5.5's $2 / $10 per million.
        $this->assertEqualsWithDelta(0.006, $first->cost_usd, 0.000001);

        $proposal = $chat->proposals()->firstOrFail();
        $continuation = $this->postJson($path.'/proposals/'.$proposal->id.'/decision', ['request_id' => (string) Str::uuid(), 'decision' => 'approve', 'content_hash' => $proposal->content_hash])
            ->assertOk()->json('data.run.id');
        (new RunAssistant($continuation))->handle();

        $final = $chat->runs()->findOrFail($continuation);
        $this->assertSame('completed', $final->status, $final->error_message ?? '');
        $this->assertSame('Identity saved. What does the probe measure?', $final->answer);
        $this->assertSame($count + 1, DeviceProfile::count());
        $this->assertSame(3, $step);
    }

    public function test_portal_settings_name_the_active_provider(): void
    {
        $this->seed(DatabaseSeeder::class);
        config(['assistant.enabled' => true, 'ai.providers.openai.key' => null, 'ai.providers.anthropic.key' => null]);
        $org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actingAs(User::where('email', 'shared.operator@example.test')->firstOrFail());
        $path = '/api/v1/organizations/'.$org->uuid.'/assistant/settings';

        $this->getJson($path)->assertOk()->assertJsonPath('data.enabled', false)->assertJsonPath('data.provider.label', 'OpenAI');
        $this->saveAnthropic('claude-haiku-5-5');
        $this->getJson($path)->assertOk()->assertJsonPath('data.enabled', true)->assertJsonPath('data.provider', ['id' => 'anthropic', 'label' => 'Anthropic']);
        $this->getJson($path.'?scope=help')->assertOk()->assertJsonPath('data.provider.id', 'anthropic');
    }

    public function test_runs_are_priced_with_the_model_that_served_them(): void
    {
        $assistant = app(AssistantProvider::class);
        $usage = ['input_tokens' => 10000, 'output_tokens' => 1000];

        $this->assertSame(0.0120, $assistant->cost($usage, 'gpt-5.4-mini-2026-03-17'));
        $this->assertSame(0.0600, $assistant->cost($usage, 'claude-opus-5-5'));
        $this->assertSame(0.0015, $assistant->cost($usage, 'claude-haiku-5-5'));
        // Above 100K input tokens Haiku is charged its long-context price.
        $this->assertSame(0.0775, $assistant->cost(['input_tokens' => 150000, 'output_tokens' => 1000], 'claude-haiku-5-5'));
        // A model nobody listed is charged at the active provider's most expensive listed model.
        config(['assistant.provider' => 'anthropic']);
        $this->assertSame(0.0600, $assistant->cost($usage, 'claude-unlisted'));
    }

    public function test_provider_options_reach_only_their_provider(): void
    {
        $openAi = ['parallel_tool_calls' => false, 'reasoning' => ['effort' => 'low']];

        $this->assertSame($openAi, AssistantProvider::options(Lab::OpenAI, $openAi, tools: true));
        $this->assertSame(['output_config' => ['effort' => 'low'], 'max_tokens' => 8000], AssistantProvider::options(Lab::Anthropic, $openAi));
        $this->assertSame(['type' => 'auto', 'disable_parallel_tool_use' => true], AssistantProvider::options('anthropic', $openAi, tools: true)['tool_choice']);
        $this->assertSame([], AssistantProvider::options(Lab::Gemini, $openAi));
    }

    public function test_provider_messages_are_redacted_of_saved_and_environment_keys(): void
    {
        config(['ai.providers.openai.key' => 'sk-environment-openai-key-5555']);
        AssistantProviderKey::create(['provider' => 'anthropic', 'api_key' => self::ANTHROPIC_KEY]);

        $this->assertSame('bad key [redacted] and [redacted]', app(AssistantProvider::class)->redact('bad key '.self::ANTHROPIC_KEY.' and sk-environment-openai-key-5555'));
    }

    private function saveAnthropic(string $model): void
    {
        AssistantSetting::create(['scope_key' => AssistantSetting::PLATFORM, 'provider' => 'anthropic', 'model' => $model, 'revision' => 1]);
        AssistantProviderKey::create(['provider' => 'anthropic', 'api_key' => self::ANTHROPIC_KEY]);
    }

    private function streamTool(string $name, array $arguments, string $id)
    {
        return $this->stream([
            ['type' => 'message_start', 'message' => ['id' => 'msg_'.$id, 'type' => 'message', 'role' => 'assistant', 'model' => 'claude-sonnet-5-5', 'content' => [], 'usage' => ['input_tokens' => 1000, 'output_tokens' => 1]]],
            ['type' => 'content_block_start', 'index' => 0, 'content_block' => ['type' => 'thinking', 'thinking' => '', 'signature' => '']],
            ['type' => 'content_block_delta', 'index' => 0, 'delta' => ['type' => 'signature_delta', 'signature' => 'sig_'.$id]],
            ['type' => 'content_block_stop', 'index' => 0],
            ['type' => 'content_block_start', 'index' => 1, 'content_block' => ['type' => 'tool_use', 'id' => 'toolu_'.$id, 'name' => $name, 'input' => []]],
            ['type' => 'content_block_delta', 'index' => 1, 'delta' => ['type' => 'input_json_delta', 'partial_json' => json_encode($arguments)]],
            ['type' => 'content_block_stop', 'index' => 1],
            ['type' => 'message_delta', 'delta' => ['stop_reason' => 'tool_use'], 'usage' => ['output_tokens' => 100]],
            ['type' => 'message_stop'],
        ]);
    }

    private function streamText(string $text)
    {
        return $this->stream([
            ['type' => 'message_start', 'message' => ['id' => 'msg_done', 'type' => 'message', 'role' => 'assistant', 'model' => 'claude-sonnet-5-5', 'content' => [], 'usage' => ['input_tokens' => 1000, 'output_tokens' => 1]]],
            ['type' => 'content_block_start', 'index' => 0, 'content_block' => ['type' => 'text', 'text' => '']],
            ['type' => 'content_block_delta', 'index' => 0, 'delta' => ['type' => 'text_delta', 'text' => $text]],
            ['type' => 'content_block_stop', 'index' => 0],
            ['type' => 'message_delta', 'delta' => ['stop_reason' => 'end_turn'], 'usage' => ['output_tokens' => 100]],
            ['type' => 'message_stop'],
        ]);
    }

    private function stream(array $events)
    {
        return Http::response(implode("\n\n", array_map(fn ($event) => 'event: '.$event['type']."\ndata: ".json_encode($event), $events))."\n\n", 200, ['Content-Type' => 'text/event-stream']);
    }
}
