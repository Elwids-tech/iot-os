<?php

declare(strict_types=1);

namespace App\Domain\Billing\Models;

use Carbon\CarbonImmutable;
use Database\Factories\BillingPlanFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

/**
 * A named set of allowances that billing accounts are assigned to (spec 028, ADR-035).
 * It stores no price. Archived plans stay on their accounts and cannot be newly
 * assigned.
 *
 * @property string $uuid
 * @property string $name
 * @property string|null $description
 * @property CarbonImmutable|null $archived_at
 */
#[Fillable(['name', 'description'])]
final class BillingPlan extends Model
{
    /** @use HasFactory<BillingPlanFactory> */
    use HasFactory;

    protected static function booted(): void
    {
        self::creating(static function (self $plan): void {
            $plan->uuid ??= (string) Str::uuid();
        });
    }

    protected static function newFactory(): BillingPlanFactory
    {
        return BillingPlanFactory::new();
    }

    public function getRouteKeyName(): string
    {
        return 'uuid';
    }

    /**
     * @return HasMany<PlanAllowance, $this>
     */
    public function allowances(): HasMany
    {
        return $this->hasMany(PlanAllowance::class);
    }

    /**
     * @return HasMany<PlanAssignment, $this>
     */
    public function assignments(): HasMany
    {
        return $this->hasMany(PlanAssignment::class);
    }

    /**
     * @param  Builder<self>  $query
     */
    public function scopeUnarchived(Builder $query): void
    {
        $query->whereNull('archived_at');
    }

    public function isArchived(): bool
    {
        return $this->archived_at !== null;
    }

    protected function casts(): array
    {
        return [
            'archived_at' => 'immutable_datetime',
        ];
    }
}
