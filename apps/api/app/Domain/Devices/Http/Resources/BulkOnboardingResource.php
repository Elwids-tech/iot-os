<?php

declare(strict_types=1);

namespace App\Domain\Devices\Http\Resources;

use App\Domain\Devices\Models\DeviceBulkOnboarding;
use App\Domain\Devices\Services\BulkOnboarding;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A bulk onboarding run with its counts and one page of items (100, by `?cursor=`).
 * Items read `active` from their device, so the run never claims an activation the
 * runtime has not acknowledged.
 *
 * @mixin DeviceBulkOnboarding
 */
final class BulkOnboardingResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $items = $this->items()->with('device:id,uuid,applied_configuration_uuid,deployment_status,diagnostic')->orderBy('id')->cursorPaginate(100);
        $artifact = $this->artifact;

        return [
            // Equals the request's operation_uuid.
            'uuid' => (string) $this->uuid,
            /** @var 'queued'|'running'|'succeeded'|'partial_failure'|'failed' */
            'status' => $this->status->value,
            'gateway_uuid' => (string) $this->gateway->uuid,
            'artifact_uuid' => (string) $artifact->uuid,
            /** @var array{uuid: string|null, name: string|null, revision: int} */
            'profile' => ['uuid' => $artifact->profile?->uuid, 'name' => $artifact->profile?->name, 'revision' => (int) $artifact->revision],
            'name_pattern' => (string) $this->name_pattern,
            // The person who started the run (integer user id, ADR-013).
            'created_by' => (int) $this->created_by,
            'created_at' => $this->created_at->toIso8601String(),
            'started_at' => $this->started_at?->toIso8601String(),
            'finished_at' => $this->finished_at?->toIso8601String(),
            // Items by status; `active` counts the activation-requested items the runtime has acknowledged.
            /** @var array{pending: int, activation_requested: int, active: int, skipped: int, failed: int} */
            'counts' => app(BulkOnboarding::class)->counts($this->resource),
            /** @var list<array{source_device_id: string, status: 'pending'|'activation_requested'|'active'|'skipped'|'failed', reason: string|null, device_uuid: string|null, attempts: int}> */
            'items' => $items->getCollection()->map(fn ($item) => BulkOnboarding::item($item))->values()->all(),
            // Pass as `cursor` for the next 100 items; null on the last page.
            'next_cursor' => $items->nextCursor()?->encode(),
        ];
    }
}
