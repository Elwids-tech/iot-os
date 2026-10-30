<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

use App\Domain\Administration\Services\OrganizationDefaultRoles;
use App\Domain\Administration\Services\OrganizationRoleManager;
use App\Domain\Authorization\Enums\OrganizationRoleName;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * An owner creates an organization under a billing account they own (spec 023 US3).
 * The account row is locked while the limit is checked, so concurrent creations cannot
 * take it past its limit (FR-017). The owner becomes the organization's Organization
 * Admin through the same path invitations use, without the welcome email.
 */
final class OwnerOrganizations
{
    public function __construct(
        private readonly OrganizationDefaultRoles $defaultRoles,
        private readonly OrganizationRoleManager $roleManager,
    ) {}

    public function create(User $owner, string $accountUuid, string $name, ?string $slug): Organization
    {
        return DB::transaction(function () use ($owner, $accountUuid, $name, $slug): Organization {
            $account = BillingAccount::query()
                ->where('uuid', $accountUuid)
                ->whereHas('owners', fn ($query) => $query->whereKey($owner->getKey()))
                ->lockForUpdate()
                ->first();

            abort_if($account === null, 404);

            $limit = $account->organization_limit;

            if ($account->organizations()->count() >= $limit) {
                throw ValidationException::withMessages(['billing_account' => sprintf(
                    'This billing account allows %d %s. Ask the platform operator to raise the limit.',
                    $limit,
                    $limit === 1 ? 'organization' : 'organizations',
                )]);
            }

            $organization = new Organization(['name' => $name, 'slug' => $slug ?? $this->freeSlug($name)]);
            $organization->billing_account_id = $account->getKey();
            $organization->save();

            $roles = $this->defaultRoles->ensure($organization);
            $owner->organizations()->attach($organization->getKey());
            $this->roleManager->syncMemberRoles($organization, $owner, [$roles[OrganizationRoleName::ORGANIZATION_ADMIN->value]->getKey()]);

            return $organization;
        });
    }

    /**
     * The name's slug, or the first free `-2`, `-3`... after it. Trashed organizations
     * count, because the unique index does.
     */
    private function freeSlug(string $name): string
    {
        $base = Str::slug($name) ?: 'organization';
        $slug = $base;

        for ($suffix = 2; Organization::withTrashed()->where('slug', $slug)->exists(); $suffix++) {
            $slug = $base.'-'.$suffix;
        }

        return $slug;
    }
}
