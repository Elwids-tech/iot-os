<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One kind of data in an organization deletion check: a blocker or something removed.
 *
 * @extends JsonResource<array{key: string, label: string, count: int}>
 */
final class OrganizationDeletionEntryResource extends JsonResource
{
    /**
     * @return array{key: string, label: string, count: int}
     */
    public function toArray(Request $request): array
    {
        return [
            'key' => (string) $this->resource['key'],
            'label' => (string) $this->resource['label'],
            'count' => (int) $this->resource['count'],
        ];
    }
}
