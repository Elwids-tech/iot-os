<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\BillingAccountAssignment;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Platform administrators' changes to billing accounts (spec 023). Every change is one
 * audit event with a null organization, as `organization.deleted` is, so audit rows
 * never block deleting an organization. Moves need no account-side event: the
 * assignments already record who and when.
 */
final class BillingAccounts
{
    private const EDITABLE = ['name', 'contact_email', 'notes', 'organization_limit'];

    /**
     * @param  array{name: string, contact_email?: ?string, notes?: ?string, organization_limit?: int}  $values
     */
    public function create(array $values, ?User $actor): BillingAccount
    {
        $account = BillingAccount::query()->create($values);

        DeviceAudit::record('billing_account.created', null, $actor?->getKey(), $account->uuid, [
            'name' => $account->name,
            'organization_limit' => $account->organization_limit,
        ]);

        return $account;
    }

    /**
     * @param  array<string, mixed>  $values
     */
    public function update(BillingAccount $account, array $values, User $actor): BillingAccount
    {
        $account->fill(array_intersect_key($values, array_flip(self::EDITABLE)));
        $changes = [];

        foreach (array_keys($account->getDirty()) as $field) {
            $changes[$field] = ['from' => $account->getOriginal($field), 'to' => $account->getAttribute($field)];
        }

        if ($changes === []) {
            return $account;
        }

        $account->save();
        DeviceAudit::record('billing_account.updated', null, $actor->getKey(), $account->uuid, ['changes' => $changes]);

        return $account;
    }

    /**
     * Soft deletes an account that has no organizations; one with organizations is a 409.
     */
    public function delete(BillingAccount $account, User $actor): void
    {
        DB::transaction(function () use ($account, $actor): void {
            $locked = BillingAccount::query()->whereKey($account->getKey())->lockForUpdate()->firstOrFail();
            $count = $locked->organizations()->count();

            abort_if($count > 0, 409, sprintf(
                "Move this billing account's %d %s before deleting it.",
                $count,
                $count === 1 ? 'organization' : 'organizations',
            ));

            $locked->delete();
            DeviceAudit::record('billing_account.deleted', null, $actor->getKey(), $locked->uuid, ['name' => $locked->name]);
        });
    }

    public function addOwner(BillingAccount $account, User $owner, User $actor): void
    {
        if ($account->owners()->whereKey($owner->getKey())->exists()) {
            return;
        }

        $account->owners()->attach($owner->getKey(), ['added_by' => $actor->getKey(), 'created_at' => now()]);
        DeviceAudit::record('billing_account.owner_added', null, $actor->getKey(), $account->uuid, [
            'user_id' => $owner->getKey(),
            'user_name' => $owner->name,
        ]);
    }

    public function removeOwner(BillingAccount $account, User $owner, User $actor): void
    {
        if ($account->owners()->detach($owner->getKey()) === 0) {
            return;
        }

        DeviceAudit::record('billing_account.owner_removed', null, $actor->getKey(), $account->uuid, [
            'user_id' => $owner->getKey(),
            'user_name' => $owner->name,
        ]);
    }

    /**
     * Moves the organization from this moment. Nothing inside it changes (FR-012), and
     * the organization limit does not apply.
     */
    public function move(Organization $organization, BillingAccount $target, User $actor): Organization
    {
        return DB::transaction(function () use ($organization, $target, $actor): Organization {
            $locked = Organization::query()->whereKey($organization->getKey())->lockForUpdate()->firstOrFail();

            if ($locked->billing_account_id === $target->getKey()) {
                return $locked;
            }

            $from = BillingAccount::withTrashed()->findOrFail($locked->billing_account_id);
            // One timestamp for both rows: two now() calls differ by microseconds and
            // would leave a gap between the periods.
            $at = now();

            BillingAccountAssignment::query()
                ->where('organization_uuid', $locked->uuid)
                ->whereNull('ended_at')
                ->update(['ended_at' => $at, 'ended_by' => $actor->getKey()]);

            BillingAccountAssignment::query()->create([
                'billing_account_id' => $target->getKey(),
                'organization_id' => $locked->getKey(),
                'organization_uuid' => $locked->uuid,
                'organization_name' => $locked->name,
                'started_at' => $at,
                'assigned_by' => $actor->getKey(),
            ]);

            $locked->forceFill(['billing_account_id' => $target->getKey()])->save();

            // The event belongs to the organization, so it shows under its activity (spec 024).
            DeviceAudit::record('organization.billing_account_changed', $locked->getKey(), $actor->getKey(), $locked->uuid, [
                'from' => ['uuid' => $from->uuid, 'name' => $from->name],
                'to' => ['uuid' => $target->uuid, 'name' => $target->name],
            ]);

            return $locked;
        });
    }
}
