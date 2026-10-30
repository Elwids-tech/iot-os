<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Resources;

use App\Domain\Billing\Services\BillingAccountChange;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @extends JsonResource<BillingAccountChange>
 */
final class BillingAccountChangeResource extends JsonResource
{
    public function __construct(BillingAccountChange $resource)
    {
        parent::__construct($resource);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var BillingAccountChange $change */
        $change = $this->resource;

        return [
            'field' => $change->field,
            'from' => $change->from === null ? null : (string) $change->from,
            'to' => $change->to === null ? null : (string) $change->to,
        ];
    }
}
