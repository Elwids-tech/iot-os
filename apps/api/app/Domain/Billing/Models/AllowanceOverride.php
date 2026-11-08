<?php

declare(strict_types=1);

namespace App\Domain\Billing\Models;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An allowance set for one billing account, replacing its plan's for a customer on
 * special terms (spec 028 FR-008). It survives plan changes until removed. Written
 * only by `Allowances`.
 *
 * @property int $billing_account_id
 * @property AllowanceKind $kind
 * @property int|null $value
 * @property string $note
 * @property int|null $set_by
 */
final class AllowanceOverride extends Model
{
    protected $table = 'billing_allowance_overrides';

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
     * @return BelongsTo<User, $this>
     */
    public function setter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'set_by');
    }
}
