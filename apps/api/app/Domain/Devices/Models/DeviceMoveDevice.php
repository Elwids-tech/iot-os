<?php

declare(strict_types=1);

namespace App\Domain\Devices\Models;

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

    public function site(): BelongsTo
    {
        return $this->belongsTo(Site::class, 'target_site_id');
    }
}
