<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Services;

use App\Domain\Assistant\Models\AssistantProviderKey;
use App\Domain\Assistant\Models\AssistantSetting;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Shared\Models\User;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Throwable;

use function Laravel\Ai\agent;

/**
 * The super-administrator settings behind the admin AI assistant page (spec 010).
 */
final class AssistantSettings
{
    public function __construct(private readonly AssistantProvider $assistant) {}

    /**
     * @return array<string, mixed>
     */
    public function inspection(): array
    {
        $setting = $this->setting();
        $keys = AssistantProviderKey::query()->get()->keyBy('provider');
        $today = DB::table('assistant_budgets')->where('day', now()->toDateString())->first();

        return [
            'enabled' => (bool) config('assistant.enabled'),
            'help_enabled' => (bool) config('assistant.help_enabled'),
            'configured' => $this->assistant->configured(),
            'provider' => $this->assistant->provider(),
            'model' => $this->assistant->model(),
            'daily_budget_usd' => $this->assistant->dailyBudget(),
            'run_budget_usd' => $this->assistant->runBudget(),
            'provider_source' => $setting?->provider !== null ? 'saved' : 'environment',
            'daily_budget_source' => $setting?->daily_budget_usd !== null ? 'saved' : 'environment',
            'run_budget_source' => $setting?->run_budget_usd !== null ? 'saved' : 'environment',
            'revision' => $setting?->revision ?? 0,
            'updated_at' => $setting?->updated_at?->toIso8601String(),
            'spent_today_usd' => (float) ($today->spent_usd ?? 0),
            'reserved_today_usd' => (float) ($today->reserved_usd ?? 0),
            'providers' => array_map(function (string $provider) use ($keys): array {
                $saved = $keys->get($provider);
                $key = $saved?->api_key ?? $this->assistant->environmentKey($provider);

                return [
                    'id' => $provider,
                    'label' => $this->assistant->label($provider),
                    'default_model' => $this->assistant->defaultModel($provider),
                    'models' => array_map(fn (string $model, array $price): array => [
                        'id' => $model,
                        'label' => $price['label'],
                        'input_usd_per_million' => $price['input_usd_per_million'],
                        'output_usd_per_million' => $price['output_usd_per_million'],
                    ], array_keys(config("assistant.providers.{$provider}.models")), config("assistant.providers.{$provider}.models")),
                    'key_source' => $saved !== null ? 'saved' : ($key !== null ? 'environment' : null),
                    'key_last_four' => $key !== null ? mb_substr($key, -4) : null,
                    'key_updated_at' => $saved?->updated_at?->toIso8601String(),
                ];
            }, $this->assistant->providers()),
        ];
    }

    /**
     * @param  array{provider: string, model: string, daily_budget_usd: float|int|null, run_budget_usd: float|int|null, revision: int, api_key?: string|null}  $values
     */
    public function update(User $actor, array $values): void
    {
        $provider = $values['provider'];
        $key = filled($values['api_key'] ?? null) ? trim($values['api_key']) : null;
        if ($key === null && $this->assistant->key($provider) === null) {
            throw ValidationException::withMessages(['api_key' => 'Add an API key for '.$this->assistant->label($provider).' before switching to it.']);
        }

        DB::transaction(function () use ($actor, $values, $provider, $key): void {
            $setting = $this->lockSetting();
            abort_unless($setting->revision === $values['revision'], 409, 'Assistant settings changed since you opened them. Load the saved settings before saving.');
            $before = $this->effective();
            $stored = [
                'provider' => $provider,
                'model' => $values['model'],
                'daily_budget_usd' => $values['daily_budget_usd'] === null ? null : (float) $values['daily_budget_usd'],
                'run_budget_usd' => $values['run_budget_usd'] === null ? null : (float) $values['run_budget_usd'],
            ];
            $replacesKey = $key !== null && AssistantProviderKey::query()->where('provider', $provider)->first()?->api_key !== $key;
            if (! $replacesKey && $stored === $setting->only(array_keys($stored))) {
                return;
            }
            if ($replacesKey) {
                AssistantProviderKey::query()->updateOrCreate(['provider' => $provider], ['api_key' => $key, 'updated_by' => $actor->id]);
            }
            $setting->update([...$stored, 'revision' => $setting->revision + 1, 'updated_by' => $actor->id]);
            DeviceAudit::record('assistant.settings.updated', null, $actor->id, null, [
                'before' => $before,
                'after' => $this->effective(),
                'key_replaced' => $replacesKey ? $provider : null,
            ]);
        });
    }

    public function removeKey(User $actor, string $provider): void
    {
        DB::transaction(function () use ($actor, $provider): void {
            // Serialize with saves, which may switch the active provider.
            $this->lockSetting();
            $saved = AssistantProviderKey::query()->where('provider', $provider)->lockForUpdate()->first();
            if ($saved === null) {
                return;
            }
            if ($provider === $this->assistant->provider() && $this->assistant->environmentKey($provider) === null) {
                throw ValidationException::withMessages(['provider' => 'This is the only key for the active provider. Switch to another provider before removing it.']);
            }
            $saved->delete();
            DeviceAudit::record('assistant.provider_key.removed', null, $actor->id, null, ['provider' => $provider]);
        });
    }

    /**
     * Send one short prompt with the given (or stored) key. Nothing is saved or charged to the allowance.
     *
     * @return array{ok: bool, latency_ms: int|null, error: string|null}
     */
    public function test(string $provider, string $model, ?string $key): array
    {
        $key = filled($key) ? trim($key) : $this->assistant->key($provider);
        if ($key === null) {
            return ['ok' => false, 'latency_ms' => null, 'error' => 'There is no API key for '.$this->assistant->label($provider).'. Enter one to test it.'];
        }
        $started = hrtime(true);
        try {
            agent(instructions: 'You confirm that a connection works.')
                ->prompt('Reply with the single word OK.', provider: $this->assistant->textProvider($provider, $key), model: $model, timeout: 20);

            return ['ok' => true, 'latency_ms' => $this->elapsed($started), 'error' => null];
        } catch (Throwable $exception) {
            $error = $exception instanceof RequestException
                ? (string) ($exception->response->json('error.message') ?? $exception->response->reason())
                : $exception->getMessage();
            $error = $this->assistant->redact(str_replace($key, '[redacted]', mb_substr($error, 0, 600)));
            logger()->info('Assistant connection test failed.', ['provider' => $provider, 'model' => $model, 'exception_type' => $exception::class]);

            return ['ok' => false, 'latency_ms' => $this->elapsed($started), 'error' => $error !== '' ? $error : 'The provider did not respond.'];
        }
    }

    /**
     * @return array{provider: string, model: string, daily_budget_usd: float, run_budget_usd: float}
     */
    private function effective(): array
    {
        return [
            'provider' => $this->assistant->provider(),
            'model' => $this->assistant->model(),
            'daily_budget_usd' => $this->assistant->dailyBudget(),
            'run_budget_usd' => $this->assistant->runBudget(),
        ];
    }

    private function lockSetting(): AssistantSetting
    {
        AssistantSetting::query()->insertOrIgnore(['scope_key' => AssistantSetting::PLATFORM, 'revision' => 0, 'created_at' => now(), 'updated_at' => now()]);

        return AssistantSetting::query()->where('scope_key', AssistantSetting::PLATFORM)->lockForUpdate()->firstOrFail();
    }

    private function setting(): ?AssistantSetting
    {
        return AssistantSetting::query()->where('scope_key', AssistantSetting::PLATFORM)->first();
    }

    private function elapsed(int $started): int
    {
        return (int) round((hrtime(true) - $started) / 1e6);
    }
}
