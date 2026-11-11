<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\BillingAccountAssignment;
use App\Domain\Billing\Models\Invoice;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Devices\Services\Pipes;
use App\Domain\Devices\Services\RetentionGuard;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Platform administrators' changes to billing accounts (spec 023). Every change is one
 * audit event with a null organization, as `organization.deleted` is, so audit rows
 * never block deleting an organization. Moves need no account-side event: the
 * assignments already record who and when.
 *
 * The organization limit is the account's `organizations` allowance, changed through
 * `Allowances` (ADR-035).
 */
final class BillingAccounts
{
    private const EDITABLE = ['name', 'contact_email', 'notes'];

    /**
     * @param  array{name: string, contact_email?: ?string, notes?: ?string}  $values
     */
    public function create(array $values, ?User $actor): BillingAccount
    {
        $account = BillingAccount::query()->create(array_intersect_key($values, array_flip(self::EDITABLE)));

        DeviceAudit::record('billing_account.created', null, $actor?->getKey(), $account->uuid, [
            'name' => $account->name,
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
            // Issued invoices are records for good (spec 029 FR-037); drafts go with the account.
            abort_if($locked->invoices()->where('status', Invoice::ISSUED)->exists(), 409, 'This billing account has issued invoices, so it cannot be deleted.');
            $locked->invoices()->where('status', Invoice::DRAFT)->get()->each->delete();
            // Its plan ends with it, so plan counts and lists leave it out (spec 028 FR-002).
            $open = $locked->planAssignments()->whereNull('ended_at')->with('plan')->first();
            $locked->planAssignments()->whereNull('ended_at')->update(['ended_at' => now(), 'ended_by' => $actor->getKey(), 'end_reason' => 'account_deleted']);
            if ($open?->isTrial()) {
                app(Trials::class)->endedBy($locked, $open->refresh(), null, 'account_deleted', $actor, email: false);
            }

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
    public function move(Organization $organization, BillingAccount $target, User $actor, bool $confirmRetention = false): Organization
    {
        // The new account's retention can be shorter (spec 029 US4).
        return app(RetentionGuard::class)->around([(int) $organization->getKey()], fn (): Organization => DB::transaction(function () use ($organization, $target, $actor): Organization {
            $locked = Organization::query()->whereKey($organization->getKey())->lockForUpdate()->firstOrFail();

            if ($locked->billing_account_id === $target->getKey()) {
                return $locked;
            }
            // Hosted devices and moves exist only inside one account (spec 031, FR-061).
            app(Pipes::class)->ensureCanLeave($locked);

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
            // Its devices now count for the new account: peaks and warnings follow (FR-007, FR-025).
            app(DeviceLimit::class)->recheck($from);
            app(DeviceLimit::class)->recheck($target);

            // The event belongs to the organization, so it shows under its activity (spec 024).
            DeviceAudit::record('organization.billing_account_changed', $locked->getKey(), $actor->getKey(), $locked->uuid, [
                'from' => ['uuid' => $from->uuid, 'name' => $from->name],
                'to' => ['uuid' => $target->uuid, 'name' => $target->name],
            ]);

            return $locked;
        }), 'organization_moved', $confirmRetention);
    }
}
