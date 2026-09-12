<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Assistant;

use App\Domain\Assistant\Jobs\RunAssistant;
use App\Domain\Assistant\Models\AssistantConversation;
use App\Domain\Assistant\Models\AssistantProposal;
use App\Domain\Assistant\Services\AssistantRecovery;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class AssistantApprovalIntegrationTest extends TestCase
{
    use RefreshDatabase;

    public static function continuationOutcomes(): array
    {
        return [[false], [true]];
    }

    #[DataProvider('continuationOutcomes')]
    public function test_native_openai_tool_loop_pauses_for_authenticated_review_and_resumes_once(bool $providerFails): void
    {
        $this->seed(DatabaseSeeder::class);
        Queue::fake();
        Http::preventStrayRequests();
        config(['assistant.enabled' => true, 'ai.providers.openai.key' => 'test-only', 'ai.providers.openai.store' => false, 'ai.conversations.generate_title' => false]);
        $org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $actor = User::where('email', 'shared.operator@example.test')->firstOrFail();
        $this->actingAs($actor);
        $base = '/api/v1/organizations/'.$org->uuid.'/assistant/conversations';
        $conversation = $this->postJson($base, [])->assertCreated()->json('data.id');
        $path = $base.'/'.$conversation;
        $count = DeviceProfile::count();
        $step = 0;
        Http::fake(['api.openai.com/*' => function ($request) use (&$step, $providerFails) {
            $this->assertFalse($request['store']);
            $this->assertFalse($request['parallel_tool_calls']);
            $calls = [];
            foreach ($request['input'] as $item) {
                if (($item['type'] ?? '') === 'function_call') {
                    $calls[] = $item['call_id'];
                }
                if (($item['type'] ?? '') === 'function_call_output') {
                    $this->assertContains($item['call_id'], $calls, 'Every tool result must follow its corresponding call, including calls from before the approval pause.');
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
            $this->assertSame(3, $step, 'The tool loop should not make unbudgeted extra requests.');
            if ($providerFails) {
                throw new ConnectionException('Simulated interruption after approval execution');
            }

            return $this->streamText('Identity saved. What does the probe measure?');
        }]);
        $run = $this->postJson($path.'/messages', ['request_id' => (string) Str::uuid(), 'text' => 'Create Approved probe, code approved-probe'])->assertAccepted()->json('data.id');
        (new RunAssistant($run))->handle();
        $chat = AssistantConversation::findOrFail($conversation);
        $this->assertSame('awaiting_approval', $chat->runs()->first()->status, $chat->runs()->first()->error_message ?? '');
        $this->assertSame($count, DeviceProfile::count());
        $proposal = $chat->proposals()->firstOrFail();
        $this->assertCount(1, app(AssistantRecovery::class)->pending($chat));
        $requestId = (string) Str::uuid();
        $input = ['request_id' => $requestId, 'decision' => 'approve', 'content_hash' => $proposal->content_hash];
        $approved = $this->postJson($path.'/proposals/'.$proposal->id.'/decision', $input)->assertOk();
        $continuation = $approved->json('data.run.id');
        $this->assertSame($count + 1, DeviceProfile::count());
        (new RunAssistant($continuation))->handle();
        $this->assertSame($providerFails ? 'failed' : 'completed', $chat->runs()->find($continuation)->status, $chat->runs()->find($continuation)->error_message ?? '');
        $this->assertSame([], app(AssistantRecovery::class)->pending($chat->fresh()));
        $this->postJson($path.'/proposals/'.$proposal->id.'/decision', $input)->assertOk();
        $this->assertDatabaseCount('assistant_profile_audits', 1);
        $this->assertSame($count + 1, DeviceProfile::count());
        $this->assertSame(3, $step);
    }

    private function streamTool(string $name, array $arguments, string $id)
    {
        $item = ['id' => 'fc_'.$id, 'call_id' => 'call_'.$id, 'type' => 'function_call', 'name' => $name, 'arguments' => json_encode($arguments)];
        $reasoning = ['id' => 'rs_'.$id, 'type' => 'reasoning', 'summary' => [], 'encrypted_content' => 'test-encrypted-reasoning'];

        return $this->stream([
            ['type' => 'response.created', 'response' => ['id' => 'resp_'.$id]],
            ['type' => 'response.output_item.done', 'output_index' => 0, 'item' => $reasoning],
            ['type' => 'response.output_item.added', 'output_index' => 0, 'item' => $item],
            ['type' => 'response.function_call_arguments.done', 'item_id' => $item['id'], 'arguments' => $item['arguments']],
            ['type' => 'response.completed', 'response' => ['id' => 'resp_'.$id, 'model' => 'gpt-5.4-mini-2026-03-17', 'status' => 'completed', 'output' => [$reasoning, $item], 'usage' => ['input_tokens' => 120, 'output_tokens' => 20]]],
        ]);
    }

    private function streamText(string $text)
    {
        return $this->stream([
            ['type' => 'response.created', 'response' => ['id' => 'resp_done']],
            ['type' => 'response.output_text.delta', 'item_id' => 'msg_done', 'delta' => $text],
            ['type' => 'response.completed', 'response' => ['id' => 'resp_done', 'model' => 'gpt-5.4-mini-2026-03-17', 'status' => 'completed', 'output' => [['type' => 'message', 'role' => 'assistant', 'content' => [['type' => 'output_text', 'text' => $text]]]], 'usage' => ['input_tokens' => 120, 'output_tokens' => 20]]],
        ]);
    }

    private function stream(array $events)
    {
        return Http::response(implode("\n\n", array_map(fn ($event) => 'data: '.json_encode($event), $events))."\n\n", 200, ['Content-Type' => 'text/event-stream']);
    }
}
