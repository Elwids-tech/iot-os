<?php

declare(strict_types=1);

namespace App\Domain\Devices\Models;

use Illuminate\Database\Eloquent\Model;

final class TelemetryRetentionSetting extends Model
{
    protected $table = 'telemetry_retention_settings';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['days' => 'integer', 'revision' => 'integer'];
    }
}
