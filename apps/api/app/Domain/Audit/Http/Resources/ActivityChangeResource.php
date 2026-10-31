<?php

declare(strict_types=1);

namespace App\Domain\Audit\Http\Resources;

use App\Domain\Audit\Services\ActivityChange;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @extends JsonResource<ActivityChange>
 */
final class ActivityChangeResource extends JsonResource
{
    public function __construct(ActivityChange $resource)
    {
        parent::__construct($resource);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var ActivityChange $change */
        $change = $this->resource;

        return [
            'field' => $change->field,
            'from' => $change->from,
            'to' => $change->to,
            'opaque' => $change->opaque,
        ];
    }
}
