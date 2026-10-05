<?php

declare(strict_types=1);

namespace App\Domain\Notifications\Models;

use Illuminate\Database\Eloquent\Model;

final class NotificationEvent extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['active' => 'boolean', 'labels' => 'array', 'occurred_at' => 'immutable_datetime', 'last_seen_at' => 'immutable_datetime'];
    }
}
