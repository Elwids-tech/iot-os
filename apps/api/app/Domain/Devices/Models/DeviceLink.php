<?php

declare(strict_types=1);

namespace App\Domain\Devices\Models;

use App\Domain\Shared\Models\Organization;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * What a cutover leaves: the archived predecessor in the source, **Moved to** the
 * target, and its successor there, **Moved from** the source (spec 031). A successor
 * that moves again is the predecessor of a new link.
 */
final class DeviceLink extends DeviceModel
{
    protected $table = 'device_links';

    protected function casts(): array
    {
        return ['cutover_at' => 'immutable_datetime', 'history_included' => 'boolean', 'history_stopped_at' => 'immutable_datetime'];
    }

    public function predecessor(): BelongsTo
    {
        return $this->belongsTo(Device::class, 'predecessor_device_id');
    }

    public function successor(): BelongsTo
    {
        return $this->belongsTo(Device::class, 'successor_device_id');
    }

    public function source(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'source_organization_id');
    }

    public function target(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'target_organization_id');
    }

    public function move(): BelongsTo
    {
        return $this->belongsTo(DeviceMove::class, 'device_move_id');
    }
}
