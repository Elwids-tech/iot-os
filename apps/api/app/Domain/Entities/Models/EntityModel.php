<?php

declare(strict_types=1);

namespace App\Domain\Entities\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

/** Entity hierarchy records: a UUID filled on create and used as the route key. */
abstract class EntityModel extends Model
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
