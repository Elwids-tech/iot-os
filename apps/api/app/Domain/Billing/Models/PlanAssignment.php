<?php

declare(strict_types=1);

namespace App\Domain\Billing\Models;

use App\Domain\Billing\Enums\PlanAssignmentKind;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/**
 * One period in which a billing account was on a plan (ADR-035). Open while `ended_at`
 * is null; an account's periods never overlap, and a gap means no plan. Written only by
 * `PlanAssignments`.
 *
 * @property string $uuid
 * @property int $billing_account_id
 * @property int $billing_plan_id
 * @property PlanAssignmentKind $kind
 * @property CarbonImmutable $started_at
 * @property CarbonImmutable|null $ended_at
 * @property CarbonImmutable|null $trial_ends_at
 * @property string|null $end_reason
 */
final class PlanAssignment extends Model
{
    protected $table = 'billing_plan_assignments';

    public $timestamps = false;

    protected $guarded = [];

    protected static function booted(): void
    {
        self::creating(static function (self $assignment): void {
            $assignment->uuid ??= (string) Str::uuid();
        });
    }

    protected function casts(): array
    {
        return [
            'kind' => PlanAssignmentKind::class,
            'started_at' => 'immutable_datetime',
            'ended_at' => 'immutable_datetime',
            'trial_ends_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<BillingPlan, $this>
     */
    public function plan(): BelongsTo
    {
        return $this->belongsTo(BillingPlan::class, 'billing_plan_id');
    }

    /**
     * @return BelongsTo<BillingAccount, $this>
     */
    public function billingAccount(): BelongsTo
    {
        return $this->belongsTo(BillingAccount::class)->withTrashed();
    }

    /**
     * @param  Builder<self>  $query
     */
    public function scopeOpen(Builder $query): void
    {
        $query->whereNull('ended_at');
    }
}
