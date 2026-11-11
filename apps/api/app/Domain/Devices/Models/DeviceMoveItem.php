<?php

declare(strict_types=1);

namespace App\Domain\Devices\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A dashboard or automation a move listed (spec 031 US2): the choice made for it, what
 * it leaves out, and the item it became in the target.
 */
final class DeviceMoveItem extends Model
{
    public const KINDS = ['dashboard', 'automation'];

    public const ACTIONS = ['move', 'copy', 'keep', 'archive'];

    protected $table = 'device_move_items';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['uses_only_moving' => 'boolean', 'omitted' => 'array', 'arrives_running' => 'boolean'];
    }

    public function move(): BelongsTo
    {
        return $this->belongsTo(DeviceMove::class, 'device_move_id');
    }
}
