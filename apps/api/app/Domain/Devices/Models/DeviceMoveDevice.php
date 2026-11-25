<?php

declare(strict_types=1);

namespace App\Domain\Devices\Models;

use App\Domain\Entities\Models\Entity;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One device of a move: its predecessor, the successor's name, code and site, and where it is. */
final class DeviceMoveDevice extends Model
{
    protected $table = 'device_move_devices';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['was_active' => 'boolean', 'arrives_active' => 'boolean'];
    }

    public function move(): BelongsTo
    {
        return $this->belongsTo(DeviceMove::class, 'device_move_id');
    }

    public function predecessor(): BelongsTo
    {
        return $this->belongsTo(Device::class, 'predecessor_device_id');
    }

    public function successor(): BelongsTo
    {
        return $this->belongsTo(Device::class, 'successor_device_id');
    }

    /** Where the successor is placed in the target (spec 009, research R7). */
    public function targetEntity(): BelongsTo
    {
        return $this->belongsTo(Entity::class, 'target_entity_id');
    }
}
