<?php

declare(strict_types=1);

namespace App\Domain\Shared\Models\Concerns;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

trait HasPublicUuid
{
    protected static function bootHasPublicUuid(): void
    {
        static::creating(static function (Model $model): void {
            $model->setAttribute('uuid', $model->getAttribute('uuid') ?? (string) Str::uuid());
        });
    }

    public function getRouteKeyName(): string
    {
        return 'uuid';
    }
}
