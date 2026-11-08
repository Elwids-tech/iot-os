<?php

declare(strict_types=1);

namespace App\Domain\Billing\Models;

use App\Domain\Billing\Enums\AllowanceKind;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One allowance on a plan. `value` is null for unlimited; a kind without a row falls
 * back to the deployment's default (ADR-035). Written only by `Plans`.
 *
 * @property int $billing_plan_id
 * @property AllowanceKind $kind
 * @property int|null $value
 */
final class PlanAllowance extends Model
{
    protected $table = 'billing_plan_allowances';

    public $timestamps = false;

    public $incrementing = false;

    protected $primaryKey = null;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'kind' => AllowanceKind::class,
            'value' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<BillingPlan, $this>
     */
    public function plan(): BelongsTo
    {
        return $this->belongsTo(BillingPlan::class, 'billing_plan_id');
    }
}
