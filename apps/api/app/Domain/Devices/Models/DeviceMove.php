<?php

declare(strict_types=1);

namespace App\Domain\Devices\Models;

use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Devices moving from one organization to another of the same billing account (spec
 * 031): `stopping` while the runtime stops the active ones, then `completed` at cutover
 * or `failed`, with what it stopped resumed.
 */
final class DeviceMove extends DeviceModel
{
    protected $table = 'device_moves';

    protected function casts(): array
    {
        return ['include_history' => 'boolean', 'review' => 'array', 'confirmed_at' => 'immutable_datetime', 'cutover_at' => 'immutable_datetime', 'finished_at' => 'immutable_datetime'];
    }

    public function source(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'source_organization_id');
    }

    public function target(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'target_organization_id');
    }

    public function mover(): BelongsTo
    {
        return $this->belongsTo(User::class, 'mover_id');
    }

    public function devices(): HasMany
    {
        return $this->hasMany(DeviceMoveDevice::class)->orderBy('id');
    }
}
