<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Assistant;

use App\Domain\Assistant\Agents\ProfileAssistant;
use App\Domain\Assistant\Jobs\RunAssistant;
use App\Domain\Assistant\Models\AssistantConversation;
use App\Domain\Assistant\Models\AssistantProposal;
use App\Domain\Assistant\Services\ProfileProposalService;
use App\Domain\Assistant\Tools\ProfileAssistantTools;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Ai\Tools\Request;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

final class AssistantTest extends TestCase
{
    use RefreshDatabase;

    private Organization $org;

    private User $actor;

    private string $base;

    protected function setUp(): void
    {
        parent::setUp();
        Http::preventStrayRequests();
        ProfileAssistant::fake(['What does this device measure?']);
        Queue::fake();
        Storage::fake('local');
        config(['assistant.enabled' => true, 'ai.providers.openai.key' => 'test-only', 'assistant.daily_budget_usd' => 0.50]);
        $this->seed(DatabaseSeeder::class);
        $this->org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actor = User::where('email', 'shared.operator@example.test')->firstOrFail();
        $this->actingAs($this->actor);
        $this->base = '/api/v1/organizations/'.$this->org->uuid.'/assistant';
    }

    private function conversation(): AssistantConversation
    {
        $id = $this->postJson($this->base.'/conversations', [])->assertCreated()->json('data.id');

        return AssistantConversation::findOrFail($id);
    }

    private function preview(AssistantConversation $conversation, array $values = []): AssistantProposal
    {
        return app(ProfileProposalService::class)->preview($conversation, [
            'section' => 'identity', 'summary' => 'Create the temperature probe profile',
            'changes' => [['operation' => 'upsert', 'uuid' => null, 'values' => $values ?: ['name' => 'Temperature probe', 'code' => 'temperature-probe']]],
        ]);
    }

    private function approve(AssistantConversation $conversation, AssistantProposal $proposal, ?string $id = null)
    {
        return $this->postJson($this->base.'/conversations/'.$conversation->id.'/proposals/'.$proposal->id.'/decision', [
            'decision' => 'approve', 'content_hash' => $proposal->content_hash, 'request_id' => $id ?? (string) Str::uuid(),
        ]);
    }

    public function test_preview_is_rolled_back_and_approval_saves_once_without_publishing(): void
    {
        $conversation = $this->conversation();
        $count = DeviceProfile::count();
        $proposal = $this->preview($conversation);
        $this->assertSame($count, DeviceProfile::count());
        $this->assertNull($conversation->fresh()->device_profile_id);
        $request = (string) Str::uuid();
        $saved = $this->approve($conversation, $proposal, $request)->assertOk()->json('data.result');
        $this->approve($conversation, $proposal, $request)->assertOk()->assertJsonPath('data.result', $saved);
        $this->assertSame($count + 1, DeviceProfile::count());
        $this->assertDatabaseCount('assistant_profile_audits', 1);
        $this->assertDatabaseCount('assistant_runs', 1);
        $this->assertSame('draft', $conversation->fresh()->profile->status->value);
    }

    public function test_owner_and_organization_scope_are_enforced_for_chats_sources_and_proposals(): void
    {
        $conversation = $this->conversation();
        $this->actingAs(User::factory()->create(['is_super_admin' => true]));
        $this->getJson($this->base.'/conversations/'.$conversation->id)->assertNotFound();
        $this->getJson($this->base.'/conversations')->assertOk()->assertJsonCount(0, 'data');
        $this->actingAs($this->actor);
        $other = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $this->getJson('/api/v1/organizations/'.$other->uuid.'/assistant/conversations/'.$conversation->id)->assertNotFound();
    }

    public function test_stale_review_and_tampered_hash_cannot_save(): void
    {
        $conversation = $this->conversation();
        $proposal = $this->preview($conversation);
        $this->postJson($this->base.'/conversations/'.$conversation->id.'/proposals/'.$proposal->id.'/decision', [
            'decision' => 'approve', 'content_hash' => str_repeat('0', 64), 'request_id' => (string) Str::uuid(),
        ])->assertConflict();
        $this->approve($conversation, $proposal)->assertOk();
        $conversation->runs()->update(['status' => 'completed', 'reserved_usd' => 0]);
        $proposal = $this->preview($conversation->fresh(), ['name' => 'Revised', 'code' => 'temperature-probe']);
        $profile = $conversation->fresh()->profile;
        $profile->increment('draft_revision');
        $this->approve($conversation, $proposal)->assertConflict();
        $this->assertSame('pending', $proposal->fresh()->status);
        $this->assertSame('Temperature probe', $profile->fresh()->name);
    }

    public function test_system_managed_fields_and_unresolved_evidence_block_saving(): void
    {
        $conversation = $this->conversation();
        $path = $this->base.'/conversations/'.$conversation->id.'/proposals';
        $input = ['section' => 'identity', 'summary' => 'Review', 'changes' => [['operation' => 'upsert', 'values' => ['name' => 'Probe', 'code' => 'probe', 'status' => 'published']]]];
        $this->postJson($path, $input)->assertUnprocessable();
        unset($input['changes'][0]['values']['status']);
        $input['evidence'] = [['field' => 'name', 'origin' => 'unresolved', 'note' => 'Confirm the model']];
        $id = $this->postJson($path, $input)->assertCreated()->assertJsonPath('data.status', 'pending')->json('data.id');
        $this->approve($conversation, AssistantProposal::findOrFail($id))->assertUnprocessable();
    }

    public function test_uploads_are_private_and_deletion_retains_applied_profile_audits(): void
    {
        $conversation = $this->conversation();
        $path = $this->base.'/conversations/'.$conversation->id;
        $this->post($path.'/sources', ['file' => UploadedFile::fake()->createWithContent('bad.png', 'not an image')], ['Accept' => 'application/json'])->assertUnprocessable();
        $source = $this->post($path.'/sources', ['file' => UploadedFile::fake()->createWithContent('sample.json', '{"temperature":21}')], ['Accept' => 'application/json'])->assertCreated()->json('data');
        $this->get($path.'/sources/'.$source['id'])->assertOk();
        $this->approve($conversation, $this->preview($conversation))->assertOk();
        $conversation->runs()->update(['status' => 'completed', 'reserved_usd' => 0]);
        $this->deleteJson($path)->assertNoContent();
        $this->assertDatabaseCount('assistant_sources', 0);
        $this->assertDatabaseCount('assistant_profile_audits', 1);
        $this->assertCount(0, Storage::disk('local')->allFiles('assistant/'.$conversation->id));
    }

    public function test_queue_budget_cancellation_and_idempotency(): void
    {
        $conversation = $this->conversation();
        $path = $this->base.'/conversations/'.$conversation->id;
        $input = ['request_id' => (string) Str::uuid(), 'text' => 'Help onboard a thermometer'];
        $run = $this->postJson($path.'/messages', $input)->assertAccepted()->json('data');
        $this->postJson($path.'/messages', $input)->assertAccepted()->assertJsonPath('data.id', $run['id']);
        $this->postJson($path.'/messages', [...$input, 'request_id' => (string) Str::uuid()])->assertConflict();
        $this->postJson($path.'/runs/'.$run['id'].'/cancel')->assertOk();
        (new RunAssistant($run['id']))->handle();
        $this->assertSame('cancelled', $conversation->runs()->first()->status);
        $this->assertEquals(0, DB::table('assistant_budgets')->value('reserved_usd'));
        config(['assistant.daily_budget_usd' => 0.01]);
        $this->postJson($path.'/messages', [...$input, 'request_id' => (string) Str::uuid()])->assertStatus(429);
    }

    public function test_questionnaire_preserves_answers_and_limits_question_count(): void
    {
        $conversation = $this->conversation();
        $conversation->update(['onboarding_state' => ['answers' => [['id' => 'purpose', 'answer' => 'Temperature']]]]);
        $run = $conversation->runs()->create(['request_id' => (string) Str::uuid(), 'status' => 'running']);
        $tool = new ProfileAssistantTools($run);
        $question = ['id' => 'unit', 'prompt' => 'What unit?', 'required' => true, 'options' => ['Celsius', 'Fahrenheit']];
        $result = $tool->handle(new Request(['action' => 'ask_questions', 'arguments_json' => json_encode(['questions' => [$question]])]));
        $this->assertArrayNotHasKey('error', json_decode((string) $result, true));
        $this->assertSame('Temperature', $conversation->fresh()->onboarding_state['answers'][0]['answer']);
        $result = $tool->handle(new Request(['action' => 'ask_questions', 'arguments_json' => json_encode(['questions' => array_fill(0, 4, $question)])]));
        $this->assertArrayHasKey('error', json_decode((string) $result, true));
    }

    public function test_mocked_worker_persists_response_and_does_not_run_twice(): void
    {
        $conversation = $this->conversation();
        $run = $this->postJson($this->base.'/conversations/'.$conversation->id.'/messages', ['request_id' => (string) Str::uuid(), 'text' => 'Hello'])->assertAccepted()->json('data');
        (new RunAssistant($run['id']))->handle();
        $saved = $conversation->runs()->first();
        $this->assertSame('completed', $saved->status, $saved->error_message ?? '');
        $this->assertSame('What does this device measure?', $saved->answer);
        (new RunAssistant($run['id']))->handle();
        ProfileAssistant::assertPrompted(fn ($prompt) => $prompt->prompt === 'Hello');
        $this->assertNotNull($conversation->fresh()->sdk_conversation_id);
    }

    public function test_parameters_groups_and_calculations_use_the_existing_draft_validator(): void
    {
        $chat = $this->conversation();
        $service = app(ProfileProposalService::class);
        $identity = $this->preview($chat);
        $identity->update(['status' => 'approved']);
        $service->apply($identity, $identity->content_hash);
        $apply = function (string $section, array $changes) use ($chat, $service) {
            $proposal = $service->preview($chat->fresh(), ['section' => $section, 'summary' => 'Review '.$section, 'changes' => $changes]);
            $proposal->update(['status' => 'approved']);

            return $service->apply($proposal, $proposal->content_hash);
        };
        $apply('parameters', [
            ['operation' => 'upsert', 'values' => ['key' => 'temperature', 'label' => 'Temperature', 'kind' => 'measurement', 'data_type' => 'number', 'unit' => '°C']],
            ['operation' => 'upsert', 'values' => ['key' => 'fahrenheit', 'label' => 'Fahrenheit', 'kind' => 'derived', 'data_type' => 'number', 'unit' => '°F']],
        ]);
        $profile = $chat->fresh()->profile;
        $this->assertCount(2, $profile->parameters);
        $apply('groups', [['operation' => 'upsert', 'values' => ['code' => 'readings', 'label' => 'Readings']]]);
        $source = $profile->parameters()->where('key', 'temperature')->firstOrFail();
        $target = $profile->parameters()->where('key', 'fahrenheit')->firstOrFail();
        $apply('calculations', [['operation' => 'upsert', 'uuid' => $target->uuid, 'values' => ['engine' => 'json_logic', 'expression' => ['+' => [['*' => [['var' => 'temp'], 1.8]], 32]], 'inputs' => [['parameter_uuid' => $source->uuid, 'alias' => 'temp']], 'trigger' => 'on_input_change', 'failure_policy' => 'mark_invalid']]]);
        $this->assertNotNull($target->fresh()->calculation);
        $this->assertSame(4, $profile->fresh()->draft_revision);
        $count = $profile->parameters()->count();
        try {
            $service->preview($chat->fresh(), ['section' => 'parameters', 'summary' => 'Remove referenced input', 'changes' => [['operation' => 'remove', 'uuid' => $source->uuid, 'values' => []]]]);
            $this->fail('A referenced calculation input must not be removed.');
        } catch (HttpException $exception) {
            $this->assertSame(422, $exception->getStatusCode());
        }
        $this->assertSame($count, $profile->parameters()->count());
    }

    public function test_revoked_membership_stops_a_queued_run_before_ai_is_called(): void
    {
        $conversation = $this->conversation();
        $id = $this->postJson($this->base.'/conversations/'.$conversation->id.'/messages', ['request_id' => (string) Str::uuid(), 'text' => 'Hello'])->assertAccepted()->json('data.id');
        $this->actor->organizations()->detach($this->org->id);
        (new RunAssistant($id))->handle();
        $this->assertSame('failed', $conversation->runs()->first()->status);
        ProfileAssistant::assertNeverPrompted();
        $this->getJson($this->base.'/conversations/'.$conversation->id)->assertForbidden();
    }

    public function test_cancelled_inflight_runs_must_settle_before_deletion_and_stale_runs_recover(): void
    {
        $conversation = $this->conversation();
        $path = $this->base.'/conversations/'.$conversation->id;
        $id = $this->postJson($path.'/messages', ['request_id' => (string) Str::uuid(), 'text' => 'Hello'])->assertAccepted()->json('data.id');
        $run = $conversation->runs()->findOrFail($id);
        $run->update(['status' => 'running', 'started_at' => now()]);
        $this->postJson($path.'/runs/'.$id.'/cancel')->assertOk();
        $this->deleteJson($path)->assertConflict();
        $this->travel(6)->minutes();
        $this->getJson($path.'/events')->assertOk();
        $this->assertEquals(0, $run->fresh()->reserved_usd);
        $this->assertSame('cancelled', $run->fresh()->status);
        $this->deleteJson($path)->assertNoContent();
    }

    public function test_extracted_source_facts_are_scoped_retained_and_not_treated_as_confirmed_values(): void
    {
        $chat = $this->conversation();
        $source = $chat->sources()->create(['name' => 'manual.txt', 'mime' => 'text/plain', 'path' => 'test.txt', 'size' => 5, 'sha256' => str_repeat('a', 64)]);
        Storage::disk('local')->put('test.txt', 'Probe');
        $run = $chat->runs()->create(['request_id' => (string) Str::uuid(), 'status' => 'running']);
        $tool = new ProfileAssistantTools($run);
        $facts = [['field' => 'temperature.unit', 'value' => '°C', 'source_id' => $source->id, 'location' => 'Page 1', 'certainty' => 'explicit']];
        $result = $tool->handle(new Request(['action' => 'record_facts', 'arguments_json' => json_encode(['facts' => $facts])]));
        $this->assertSame(1, json_decode((string) $result, true)['recorded']);
        $this->assertSame($facts, $chat->fresh()->onboarding_state['source_facts']);
        $other = $this->conversation();
        $otherRun = $other->runs()->create(['request_id' => (string) Str::uuid(), 'status' => 'running']);
        $result = (new ProfileAssistantTools($otherRun))->handle(new Request(['action' => 'record_facts', 'arguments_json' => json_encode(['facts' => $facts])]));
        $this->assertArrayHasKey('error', json_decode((string) $result, true));
    }

    public function test_conversion_and_combined_output_proposals_are_reviewed_and_applied_once(): void
    {
        $chat = $this->conversation();
        $service = app(ProfileProposalService::class);
        $identity = $this->preview($chat);
        $identity->update(['status' => 'approved']);
        $service->apply($identity, $identity->content_hash);
        $conversion = $service->preview($chat->fresh(), ['section' => 'parameters', 'summary' => 'Receive W, store kW', 'changes' => [['operation' => 'upsert', 'values' => ['key' => 'power', 'label' => 'Power', 'kind' => 'measurement', 'data_type' => 'number', 'unit' => 'kW', 'ingress_conversion' => ['source_unit' => 'W', 'multiplier' => 0.001, 'offset' => 0]]]]]);
        $this->assertSame(0, $chat->fresh()->profile->parameters()->count());
        $conversion->update(['status' => 'approved']);
        $service->apply($conversion, $conversion->content_hash);
        $source = $chat->fresh()->profile->parameters()->firstOrFail();
        $this->assertEquals(0.001, $source->ingress_conversion['multiplier']);
        $proposal = $service->preview($chat->fresh(), ['section' => 'calculations', 'summary' => 'Create double power', 'changes' => [['operation' => 'upsert', 'uuid' => null, 'values' => ['output' => ['key' => 'double_power', 'label' => 'Double power', 'data_type' => 'number', 'unit' => 'kW'], 'engine' => 'json_logic', 'expression' => ['*' => [['var' => 'power'], 2]], 'inputs' => [['parameter_uuid' => $source->uuid, 'alias' => 'power']]]]]]);
        $this->assertSame(1, $chat->fresh()->profile->parameters()->count());
        $revision = $chat->fresh()->profile->draft_revision;
        $proposal->update(['status' => 'approved']);
        $first = $service->apply($proposal, $proposal->content_hash);
        $this->assertSame($first, $service->apply($proposal->fresh(), $proposal->content_hash));
        $profile = $chat->fresh()->profile;
        $this->assertSame(2, $profile->parameters()->count());
        $this->assertSame($revision + 1, $profile->draft_revision);
        $this->assertNotNull($profile->parameters()->where('key', 'double_power')->firstOrFail()->calculation);
        $this->assertSame(0, $profile->artifacts()->count());
    }
}
