<?php

declare(strict_types=1);

namespace App\Domain\Agents\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

abstract class AgentModel extends Model
{
    protected $guarded = [];

    protected static function booted(): void
    {
        static::creating(function (Model $model): void {
            if ($model->usesUuid()) {
                $model->uuid ??= (string) Str::uuid();
            }
        });
    }

    protected function usesUuid(): bool
    {
        return true;
    }

    public function getRouteKeyName(): string
    {
        return 'uuid';
    }
}
