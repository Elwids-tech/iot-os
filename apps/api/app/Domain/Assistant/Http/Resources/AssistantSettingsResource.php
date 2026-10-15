<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The admin AI assistant page. Keys are never included, only where each comes from and its last four characters.
 */
final class AssistantSettingsResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'enabled' => (bool) $this->resource['enabled'],
            'help_enabled' => (bool) $this->resource['help_enabled'],
            'configured' => (bool) $this->resource['configured'],
            'provider' => (string) $this->resource['provider'],
            'model' => (string) $this->resource['model'],
            'daily_budget_usd' => (float) $this->resource['daily_budget_usd'],
            'run_budget_usd' => (float) $this->resource['run_budget_usd'],
            'sources' => $this->sources(),
            'revision' => (int) $this->resource['revision'],
            'updated_at' => $this->resource['updated_at'] === null ? null : (string) $this->resource['updated_at'],
            'today' => $this->today(),
            'providers' => AssistantProviderResource::collection($this->resource['providers']),
        ];
    }

    /**
     * @return array{provider: 'saved'|'environment', daily_budget_usd: 'saved'|'environment', run_budget_usd: 'saved'|'environment'}
     */
    private function sources(): array
    {
        return [
            'provider' => $this->resource['provider_source'] === 'saved' ? 'saved' : 'environment',
            'daily_budget_usd' => $this->resource['daily_budget_source'] === 'saved' ? 'saved' : 'environment',
            'run_budget_usd' => $this->resource['run_budget_source'] === 'saved' ? 'saved' : 'environment',
        ];
    }

    /**
     * @return array{spent_usd: float, reserved_usd: float}
     */
    private function today(): array
    {
        return [
            'spent_usd' => (float) $this->resource['spent_today_usd'],
            'reserved_usd' => (float) $this->resource['reserved_today_usd'],
        ];
    }
}
