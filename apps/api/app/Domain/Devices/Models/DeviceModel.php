<?php

declare(strict_types=1);

namespace App\Domain\Devices\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

abstract class DeviceModel extends Model
{
    protected $guarded = [];

    protected static function booted(): void
    {
        static::creating(function (Model $model): void {
            $model->uuid ??= (string) Str::uuid();
        });
    }

    public function getRouteKeyName(): string
    {
        return 'uuid';
    }
}
