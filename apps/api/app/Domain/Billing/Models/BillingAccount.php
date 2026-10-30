<?php

declare(strict_types=1);

namespace App\Domain\Billing\Models;

use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Factories\BillingAccountFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;

/**
 * The payer of record for one or more organizations (spec 023, ADR-026). It groups
 * organizations for billing and grants no access to them.
 *
 * @property int $organization_limit
 */
#[Fillable(['name', 'contact_email', 'notes', 'organization_limit'])]
final class BillingAccount extends Model
{
    /** @use HasFactory<BillingAccountFactory> */
    use HasFactory, SoftDeletes;

    /** Mirrors the column default, which the audit event reads before a refresh. */
    protected $attributes = [
        'organization_limit' => 1,
    ];

    protected static function booted(): void
    {
        self::creating(static function (self $account): void {
            $account->uuid ??= (string) Str::uuid();
        });
    }

    protected static function newFactory(): BillingAccountFactory
    {
        return BillingAccountFactory::new();
    }

    public function getRouteKeyName(): string
    {
        return 'uuid';
    }

    /**
     * People a platform administrator allowed to see the account and create
     * organizations under it. The pivot has `created_at` but no `updated_at`.
     *
     * @return BelongsToMany<User, $this>
     */
    public function owners(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'billing_account_owners')
            ->withPivot(['added_by', 'created_at']);
    }

    /**
     * @return HasMany<Organization, $this>
     */
    public function organizations(): HasMany
    {
        return $this->hasMany(Organization::class);
    }

    /**
     * @return HasMany<BillingAccountAssignment, $this>
     */
    public function assignments(): HasMany
    {
        return $this->hasMany(BillingAccountAssignment::class);
    }

    protected function casts(): array
    {
        return [
            'organization_limit' => 'integer',
        ];
    }
}
