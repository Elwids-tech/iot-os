<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Assistant;

use App\Domain\Assistant\Models\AssistantProviderKey;
use App\Domain\Assistant\Services\AssistantProvider;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

final class AssistantSettingsApiTest extends TestCase
{
    use RefreshDatabase;

    private const ENVIRONMENT_OPENAI_KEY = 'sk-environment-openai-key-1111';

    private const ANTHROPIC_KEY = 'sk-ant-test-only-anthropic-key-2222';

    private const PATH = '/api/v1/admin/assistant-settings';

    private User $superAdmin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        config(['assistant.enabled' => true, 'assistant.provider' => 'openai', 'assistant.model' => null, 'assistant.daily_budget_usd' => 2.0, 'assistant.run_budget_usd' => 0.04,
            'ai.providers.openai.key' => self::ENVIRONMENT_OPENAI_KEY, 'ai.providers.anthropic.key' => null]);
        Http::preventStrayRequests();
        $this->superAdmin = User::query()->where('email', 'super-admin@example.test')->firstOrFail();
    }

    public function test_only_super_administrators_manage_assistant_settings(): void
    {
        $administrator = User::query()->where('email', 'platform-admin@example.test')->firstOrFail();
        $member = User::query()->where('email', 'acme.member@example.test')->firstOrFail();

        foreach ([$administrator, $member] as $actor) {
            $this->actingAs($actor, 'sanctum')->getJson(self::PATH)->assertForbidden();
            $this->actingAs($actor, 'sanctum')->putJson(self::PATH, $this->anthropic())->assertForbidden();
            $this->actingAs($actor, 'sanctum')->deleteJson(self::PATH.'/keys/openai')->assertForbidden();
            $this->actingAs($actor, 'sanctum')->postJson(self::PATH.'/test', ['provider' => 'openai', 'model' => 'gpt-5.4-mini-2026-03-17'])->assertForbidden();
            $this->actingAs($actor, 'sanctum')->getJson('/api/v1/me')->assertJsonPath('data.capabilities.manage_assistant', false);
        }
        $this->actingAs($this->superAdmin, 'sanctum')->getJson('/api/v1/me')->assertJsonPath('data.capabilities.manage_assistant', true);
        $this->assertDatabaseCount('assistant_settings', 0);
        $this->assertDatabaseCount('assistant_provider_keys', 0);
    }

    public function test_with_nothing_saved_the_environment_applies(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')->getJson(self::PATH)
            ->assertOk()
            ->assertJsonPath('data.configured', true)
            ->assertJsonPath('data.provider', 'openai')
            ->assertJsonPath('data.model', 'gpt-5.4-mini-2026-03-17')
            ->assertJsonPath('data.run_budget_usd', 0.04)
            ->assertJsonPath('data.sources.provider', 'environment')
            ->assertJsonPath('data.revision', 0)
            ->assertJsonPath('data.providers.0.key.source', 'environment')
            ->assertJsonPath('data.providers.0.key.last_four', '1111')
            ->assertJsonPath('data.providers.1.id', 'anthropic')
            ->assertJsonPath('data.providers.1.key.source', null)
            ->assertJsonMissing(['last_four' => self::ENVIRONMENT_OPENAI_KEY]);
        $this->assertStringNotContainsString(self::ENVIRONMENT_OPENAI_KEY, $this->actingAs($this->superAdmin, 'sanctum')->getJson(self::PATH)->content());
    }

    public function test_switching_provider_stores_the_key_encrypted_and_audits_without_it(): void
    {
        $response = $this->actingAs($this->superAdmin, 'sanctum')->putJson(self::PATH, $this->anthropic(['api_key' => self::ANTHROPIC_KEY]))
            ->assertOk()
            ->assertJsonPath('data.provider', 'anthropic')
            ->assertJsonPath('data.model', 'claude-sonnet-5-5')
            ->assertJsonPath('data.daily_budget_usd', 5)
            ->assertJsonPath('data.run_budget_usd', 0.2)
            ->assertJsonPath('data.sources.provider', 'saved')
            ->assertJsonPath('data.revision', 1)
            ->assertJsonPath('data.providers.1.key.source', 'saved')
            ->assertJsonPath('data.providers.1.key.last_four', '2222');
        $this->assertStringNotContainsString(self::ANTHROPIC_KEY, $response->content());

        $stored = DB::table('assistant_provider_keys')->where('provider', 'anthropic')->value('api_key');
        $this->assertNotSame(self::ANTHROPIC_KEY, $stored);
        $this->assertSame(self::ANTHROPIC_KEY, AssistantProviderKey::query()->where('provider', 'anthropic')->firstOrFail()->api_key);

        $assistant = app(AssistantProvider::class);
        $this->assertSame(['anthropic', 'claude-sonnet-5-5', self::ANTHROPIC_KEY, 5.0, 0.2], [$assistant->provider(), $assistant->model(), $assistant->key(), $assistant->dailyBudget(), $assistant->runBudget()]);

        $audit = DB::table('activity_log')->where('event', 'assistant.settings.updated')->sole();
        $this->assertNull($audit->organization_id);
        $this->assertSame($this->superAdmin->id, $audit->causer_id);
        $this->assertStringNotContainsString(self::ANTHROPIC_KEY, $audit->properties);
        $details = json_decode($audit->properties, true);
        $this->assertSame(['openai', 'anthropic', 'anthropic'], [$details['before']['provider'], $details['after']['provider'], $details['key_replaced']]);
    }

    public function test_a_save_that_changes_nothing_records_nothing(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')->putJson(self::PATH, $this->anthropic(['api_key' => self::ANTHROPIC_KEY]))->assertOk();
        $this->actingAs($this->superAdmin, 'sanctum')->putJson(self::PATH, $this->anthropic(['revision' => 1, 'api_key' => self::ANTHROPIC_KEY]))
            ->assertOk()
            ->assertJsonPath('data.revision', 1);
        $this->actingAs($this->superAdmin, 'sanctum')->putJson(self::PATH, $this->anthropic(['revision' => 1]))
            ->assertOk()
            ->assertJsonPath('data.revision', 1);

        $this->assertSame(1, DB::table('activity_log')->where('event', 'assistant.settings.updated')->count());
    }

    public function test_a_stale_revision_is_refused(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')->putJson(self::PATH, $this->anthropic(['api_key' => self::ANTHROPIC_KEY]))->assertOk();

        $this->actingAs($this->superAdmin, 'sanctum')->putJson(self::PATH, $this->anthropic(['model' => 'claude-haiku-5-5']))->assertConflict();
        $this->assertSame('claude-sonnet-5-5', app(AssistantProvider::class)->model());
    }

    public function test_invalid_settings_are_refused(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')->putJson(self::PATH, $this->anthropic())
            ->assertUnprocessable()->assertJsonValidationErrors(['api_key']);
        $this->actingAs($this->superAdmin, 'sanctum')->putJson(self::PATH, $this->anthropic(['model' => 'gpt-5.4-mini-2026-03-17', 'api_key' => self::ANTHROPIC_KEY]))
            ->assertUnprocessable()->assertJsonValidationErrors(['model']);
        $this->actingAs($this->superAdmin, 'sanctum')->putJson(self::PATH, $this->anthropic(['run_budget_usd' => 6, 'api_key' => self::ANTHROPIC_KEY]))
            ->assertUnprocessable()->assertJsonValidationErrors(['run_budget_usd']);
        $this->actingAs($this->superAdmin, 'sanctum')->putJson(self::PATH, $this->anthropic(['api_key' => 'sk-ant-with a space-1234567890']))
            ->assertUnprocessable()->assertJsonValidationErrors(['api_key']);

        $this->assertDatabaseCount('assistant_provider_keys', 0);
        $this->assertSame('openai', app(AssistantProvider::class)->provider());
    }

    public function test_removing_a_saved_key_falls_back_but_never_leaves_the_active_provider_without_one(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')->putJson(self::PATH, $this->anthropic(['api_key' => self::ANTHROPIC_KEY]))->assertOk();

        $this->actingAs($this->superAdmin, 'sanctum')->deleteJson(self::PATH.'/keys/anthropic')
            ->assertUnprocessable()->assertJsonValidationErrors(['provider']);
        $this->assertSame(self::ANTHROPIC_KEY, app(AssistantProvider::class)->key());

        config(['ai.providers.anthropic.key' => 'sk-ant-environment-key-3333']);
        $this->actingAs($this->superAdmin, 'sanctum')->deleteJson(self::PATH.'/keys/anthropic')
            ->assertOk()
            ->assertJsonPath('data.providers.1.key.source', 'environment')
            ->assertJsonPath('data.providers.1.key.last_four', '3333');
        $this->actingAs($this->superAdmin, 'sanctum')->deleteJson(self::PATH.'/keys/anthropic')->assertOk();

        $this->assertSame(1, DB::table('activity_log')->where('event', 'assistant.provider_key.removed')->where('properties->provider', 'anthropic')->count());
        $this->actingAs($this->superAdmin, 'sanctum')->deleteJson(self::PATH.'/keys/gemini')->assertNotFound();
    }

    public function test_connection_test_reports_success_without_saving_or_spending(): void
    {
        Http::fake(['api.anthropic.com/*' => Http::response(['id' => 'msg_1', 'type' => 'message', 'role' => 'assistant', 'model' => 'claude-haiku-5-5',
            'content' => [['type' => 'text', 'text' => 'OK']], 'stop_reason' => 'end_turn', 'usage' => ['input_tokens' => 12, 'output_tokens' => 2]])]);

        $this->actingAs($this->superAdmin, 'sanctum')->postJson(self::PATH.'/test', ['provider' => 'anthropic', 'model' => 'claude-haiku-5-5', 'api_key' => self::ANTHROPIC_KEY])
            ->assertOk()
            ->assertJsonPath('data.ok', true)
            ->assertJsonPath('data.error', null);

        Http::assertSent(fn ($request) => $request->hasHeader('x-api-key', self::ANTHROPIC_KEY) && $request['model'] === 'claude-haiku-5-5');
        $this->assertDatabaseCount('assistant_provider_keys', 0);
        $this->assertDatabaseCount('assistant_settings', 0);
        $this->assertSame(0, DB::table('assistant_budgets')->count());
    }

    public function test_connection_test_failures_never_reveal_the_key_and_are_rate_limited(): void
    {
        Http::fake(['api.anthropic.com/*' => Http::response(['type' => 'error', 'error' => ['type' => 'authentication_error', 'message' => 'invalid x-api-key '.self::ANTHROPIC_KEY]], 401)]);

        $response = $this->actingAs($this->superAdmin, 'sanctum')->postJson(self::PATH.'/test', ['provider' => 'anthropic', 'model' => 'claude-opus-5-5', 'api_key' => self::ANTHROPIC_KEY])
            ->assertOk()
            ->assertJsonPath('data.ok', false);
        $this->assertNotEmpty($response->json('data.error'));
        $this->assertStringNotContainsString(self::ANTHROPIC_KEY, $response->content());

        $this->actingAs($this->superAdmin, 'sanctum')->postJson(self::PATH.'/test', ['provider' => 'anthropic', 'model' => 'claude-opus-5-5'])
            ->assertOk()
            ->assertJsonPath('data.ok', false)
            ->assertJsonPath('data.latency_ms', null);
        foreach (range(1, 4) as $attempt) {
            $this->actingAs($this->superAdmin, 'sanctum')->postJson(self::PATH.'/test', ['provider' => 'anthropic', 'model' => 'claude-opus-5-5'])->assertOk();
        }
        $this->actingAs($this->superAdmin, 'sanctum')->postJson(self::PATH.'/test', ['provider' => 'anthropic', 'model' => 'claude-opus-5-5'])->assertTooManyRequests();
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function anthropic(array $overrides = []): array
    {
        return [...['provider' => 'anthropic', 'model' => 'claude-sonnet-5-5', 'daily_budget_usd' => 5, 'run_budget_usd' => 0.2, 'revision' => 0], ...$overrides];
    }
}
