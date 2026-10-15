<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One provider on the admin AI assistant page: its models and where its key comes from, never the key.
 */
final class AssistantProviderResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => (string) $this->resource['id'],
            'label' => (string) $this->resource['label'],
            'default_model' => (string) $this->resource['default_model'],
            'models' => AssistantModelResource::collection($this->resource['models']),
            'key' => $this->key(),
        ];
    }

    /**
     * @return array{source: 'saved'|'environment'|null, last_four: string|null, updated_at: string|null}
     */
    private function key(): array
    {
        return [
            'source' => match ($this->resource['key_source']) {
                'saved' => 'saved',
                'environment' => 'environment',
                default => null,
            },
            'last_four' => $this->resource['key_last_four'] === null ? null : (string) $this->resource['key_last_four'],
            'updated_at' => $this->resource['key_updated_at'] === null ? null : (string) $this->resource['key_updated_at'],
        ];
    }
}
