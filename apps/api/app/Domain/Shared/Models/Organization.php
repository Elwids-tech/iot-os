<?php

declare(strict_types=1);

namespace App\Domain\Shared\Models;

use Database\Factories\OrganizationFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;

#[Fillable(['name', 'slug'])]
class Organization extends Model
{
    /** @use HasFactory<OrganizationFactory> */
    use HasFactory, SoftDeletes;

    protected static function booted(): void
    {
        static::creating(function (Organization $organization): void {
            $organization->uuid ??= (string) Str::uuid();
        });
    }

    protected static function newFactory(): OrganizationFactory
    {
        return OrganizationFactory::new();
    }

    public function getRouteKeyName(): string
    {
        return 'uuid';
    }
}
