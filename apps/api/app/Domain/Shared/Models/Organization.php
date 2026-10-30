<?php

declare(strict_types=1);

namespace App\Domain\Shared\Models;

use App\Domain\Authorization\Models\Role;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\BillingAccountAssignment;
use Database\Factories\OrganizationFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;
use Spatie\Permission\Models\Permission;

/**
 * @property bool $permissions_restricted
 */
#[Fillable(['name', 'slug'])]
class Organization extends Model
{
    /** @use HasFactory<OrganizationFactory> */
    use HasFactory, SoftDeletes;

    protected static function booted(): void
    {
        static::creating(function (Organization $organization): void {
            $organization->uuid ??= (string) Str::uuid();

            // Every organization belongs to exactly one billing account (spec 023). The
            // admin and owner paths set it; this covers factories, seeders and bootstrap.
            if ($organization->billing_account_id === null) {
                $organization->billing_account_id = BillingAccount::query()->create([
                    'name' => $organization->name,
                    'organization_limit' => 1,
                ])->getKey();
            }
        });

        static::created(function (Organization $organization): void {
            BillingAccountAssignment::query()->create([
                'billing_account_id' => $organization->billing_account_id,
                'organization_id' => $organization->getKey(),
                'organization_uuid' => $organization->uuid,
                'organization_name' => $organization->name,
                'started_at' => $organization->created_at ?? now(),
                'assigned_by' => auth()->id(),
            ]);
        });
    }

    protected static function newFactory(): OrganizationFactory
    {
        return OrganizationFactory::new();
    }

    /**
     * @return BelongsToMany<User, $this>
     */
    public function users(): BelongsToMany
    {
        return $this->belongsToMany(User::class);
    }

    /**
     * The payer of record (spec 023). It grants no access to the organization.
     *
     * @return BelongsTo<BillingAccount, $this>
     */
    public function billingAccount(): BelongsTo
    {
        return $this->belongsTo(BillingAccount::class);
    }

    /**
     * @return HasMany<Role, $this>
     */
    public function roles(): HasMany
    {
        return $this->hasMany(Role::class);
    }

    /**
     * The permission ceiling, used only while permissions_restricted is set.
     *
     * @return BelongsToMany<Permission, $this>
     */
    public function permissions(): BelongsToMany
    {
        return $this->belongsToMany(Permission::class, 'organization_permission');
    }

    public function getRouteKeyName(): string
    {
        return 'uuid';
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'permissions_restricted' => 'boolean',
        ];
    }
}
