<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Resources;

use App\Domain\Billing\Models\CreditNote;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A credit note (spec 029 FR-035): `applied` was taken off its invoice, the rest of
 * `amount` became account credit. Amounts are in the invoice currency's minor units.
 *
 * @extends JsonResource<CreditNote>
 */
final class CreditNoteResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'uuid' => (string) $this->resource->uuid,
            'number' => (string) $this->resource->number,
            'invoice' => ['uuid' => (string) $this->resource->invoice->uuid, 'number' => (string) $this->resource->invoice->number],
            'currency' => (string) $this->resource->invoice->currency,
            'amount' => (int) $this->resource->amount,
            'applied' => (int) $this->resource->applied,
            'reason' => (string) $this->resource->reason,
            'issued_at' => $this->resource->issued_at->toIso8601String(),
        ];
    }
}
