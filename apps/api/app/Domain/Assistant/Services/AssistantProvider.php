<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Services;

use App\Domain\Assistant\Models\AssistantProviderKey;
use App\Domain\Assistant\Models\AssistantSetting;
use Laravel\Ai\Ai;
use Laravel\Ai\Enums\Lab;

/**
 * Which AI provider, model, key and spend limits the assistant uses: the settings saved
 * in admin first, then the server environment (spec 010). Read on every run, so a saved
 * change applies to the next reply without a restart.
 */
final class AssistantProvider
{
    /**
     * @return list<string>
     */
    public function providers(): array
    {
        return array_keys(config('assistant.providers'));
    }

    public function provider(): string
    {
        return $this->setting()?->provider ?? (string) config('assistant.provider');
    }

    public function model(): string
    {
        $setting = $this->setting();
        if ($setting?->provider !== null) {
            return $setting->model ?? $this->defaultModel($setting->provider);
        }

        return config('assistant.model') ?? $this->defaultModel($this->provider());
    }

    public function label(?string $provider = null): string
    {
        $provider ??= $this->provider();

        return (string) config("assistant.providers.{$provider}.label", $provider);
    }

    public function defaultModel(string $provider): string
    {
        return (string) config("assistant.providers.{$provider}.default_model");
    }

    public function key(?string $provider = null): ?string
    {
        $provider ??= $this->provider();

        return $this->savedKey($provider) ?? $this->environmentKey($provider);
    }

    /**
     * @return 'saved'|'environment'|null
     */
    public function keySource(string $provider): ?string
    {
        return match (true) {
            $this->savedKey($provider) !== null => 'saved',
            $this->environmentKey($provider) !== null => 'environment',
            default => null,
        };
    }

    public function environmentKey(string $provider): ?string
    {
        $key = config("ai.providers.{$provider}.key");

        return filled($key) ? (string) $key : null;
    }

    public function configured(): bool
    {
        return (bool) config('assistant.enabled') && $this->key() !== null;
    }

    public function dailyBudget(): float
    {
        return $this->setting()?->daily_budget_usd ?? (float) config('assistant.daily_budget_usd');
    }

    public function runBudget(): float
    {
        return $this->setting()?->run_budget_usd ?? (float) config('assistant.run_budget_usd');
    }

    /**
     * Build a Laravel AI provider with the resolved key and return its name for prompt() and stream().
     * Laravel AI flushes on-demand providers between queue jobs, so a rotated key takes effect on the next run.
     */
    public function textProvider(?string $provider = null, ?string $key = null): string
    {
        $provider ??= $this->provider();

        return Ai::build([...config("ai.providers.{$provider}", ['driver' => $provider]), 'key' => $key ?? $this->key($provider)])->name();
    }

    /**
     * Estimated cost in USD of the reported usage, at the given model's prices.
     *
     * @param  array<string, mixed>  $usage
     */
    public function cost(array $usage, ?string $model = null): float
    {
        // Laravel AI 1.x totals already include cached input and reasoning output; rows
        // stored before 1.x use prompt/completion keys that excluded cached input.
        $input = array_key_exists('input_tokens', $usage)
            ? $usage['input_tokens'] ?? 0
            : ($usage['prompt_tokens'] ?? 0) + ($usage['cache_read_input_tokens'] ?? 0) + ($usage['cache_write_input_tokens'] ?? 0);
        $output = $usage['output_tokens'] ?? $usage['completion_tokens'] ?? 0;
        $price = $this->price($model ?? $this->model());
        // Steps are summed, so a run past the threshold may be charged the long-context price in full: an overestimate, never an underestimate.
        if (isset($price['long_context']) && $input > $price['long_context']['above_input_tokens']) {
            $price = $price['long_context'];
        }

        return round(($input * $price['input_usd_per_million'] + $output * $price['output_usd_per_million']) / 1000000, 6);
    }

    /**
     * The listed prices for a model, or the active provider's most expensive listed model for one that is not listed.
     *
     * @return array{input_usd_per_million: float, output_usd_per_million: float, long_context?: array{above_input_tokens: int, input_usd_per_million: float, output_usd_per_million: float}}
     */
    public function price(string $model): array
    {
        foreach (config('assistant.providers') as $provider) {
            if (isset($provider['models'][$model])) {
                return $provider['models'][$model];
            }
        }
        $models = config('assistant.providers.'.$this->provider().'.models') ?: array_merge(...array_column(config('assistant.providers'), 'models'));

        return collect($models)->sortByDesc(fn (array $price): float => $price['input_usd_per_million'] + $price['output_usd_per_million'])->first();
    }

    /**
     * Remove every saved and environment key from a provider message before it is logged or shown.
     */
    public function redact(string $message): string
    {
        $keys = AssistantProviderKey::query()->get()->pluck('api_key')
            ->merge(array_map(fn (string $provider): ?string => $this->environmentKey($provider), $this->providers()))
            ->filter()->unique()->all();

        return $keys === [] ? $message : str_replace($keys, '[redacted]', $message);
    }

    /**
     * Provider options for an agent: each provider receives only its own request fields.
     *
     * @param  array<string, mixed>  $openAi  The agent's OpenAI options (reasoning effort, parallel tool calls, storage).
     * @return array<string, mixed>
     */
    public static function options(Lab|string $provider, array $openAi = [], bool $tools = false): array
    {
        return match ($provider instanceof Lab ? $provider->value : $provider) {
            'openai' => $openAi,
            // Thinking counts against max_tokens and cannot be turned off on current Claude models.
            'anthropic' => [
                'output_config' => ['effort' => 'low'],
                'max_tokens' => 8000,
                ...($tools ? ['tool_choice' => ['type' => 'auto', 'disable_parallel_tool_use' => true]] : []),
            ],
            default => [],
        };
    }

    private function savedKey(string $provider): ?string
    {
        $key = AssistantProviderKey::query()->where('provider', $provider)->first()?->api_key;

        return filled($key) ? $key : null;
    }

    private function setting(): ?AssistantSetting
    {
        return AssistantSetting::query()->where('scope_key', AssistantSetting::PLATFORM)->first();
    }
}
