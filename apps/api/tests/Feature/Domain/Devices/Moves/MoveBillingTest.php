<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices\Moves;

use App\Domain\Administration\Services\OrganizationDeletion;
use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\Allowances;
use App\Domain\Billing\Services\DeviceLimit;
use App\Domain\Shared\Models\User;
use Carbon\CarbonImmutable;

/**
 * Moves are neutral for billing (spec 031 FR-012, SC-006, research R4), and hosted devices
 * keep both organizations in their account (FR-061).
 */
final class MoveBillingTest extends MoveTestCase
{
    public function test_at_the_device_limit_an_active_device_moves_and_arrives_active_with_count_and_peak_unchanged(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $account = BillingAccount::findOrFail($this->a->billing_account_id);
        $limit = app(DeviceLimit::class);
        app(Allowances::class)->override($account, AllowanceKind::Devices, $limit->count($account)['total'], 'At the limit', $this->mover);
        [$count, $peak] = [$limit->count($account)['total'], $limit->peak($account, CarbonImmutable::now())];

        $this->moved($this->a, $this->b, [$x]);
        $successor = $this->successor($x);
        $this->applied($successor);

        $this->assertSame('active', $successor->fresh()->lifecycle);
        $this->assertSame($count, $limit->count($account)['total']);
        $this->assertSame($peak, $limit->peak($account, CarbonImmutable::now()));
        $organizations = collect($limit->count($account)['organizations'])->pluck('count', 'name');
        $this->assertSame(1, $organizations['Harbour Shop']);
    }

    public function test_organizations_with_hosted_devices_cannot_leave_the_account_or_be_deleted(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $this->moved($this->a, $this->b, [$x]);
        $platform = User::where('email', 'super-admin@example.test')->firstOrFail();
        $elsewhere = BillingAccount::create(['name' => 'Elsewhere billing']);

        $this->as($platform, function () use ($elsewhere): void {
            // The pipe owner serves Harbour Shop's device; Harbour Shop reports through Integrator's adapter.
            $this->putJson('/api/v1/admin/organizations/'.$this->a->uuid.'/billing-account', ['billing_account_uuid' => $elsewhere->uuid])
                ->assertConflict()->assertJsonPath('hosted_devices.organizations', [['name' => 'Harbour Shop', 'devices' => ['Tracker X']]]);
            $this->putJson('/api/v1/admin/organizations/'.$this->b->uuid.'/billing-account', ['billing_account_uuid' => $elsewhere->uuid])
                ->assertConflict()->assertJsonPath('hosted_devices.organizations', [['name' => 'Integrator', 'devices' => ['Tracker X']]]);
        });
        $this->assertSame($this->a->billing_account_id, $this->b->fresh()->billing_account_id);
        $deletion = app(OrganizationDeletion::class);
        foreach ([$this->a, $this->b] as $organization) {
            $this->assertContains(['key' => 'hosted_devices', 'label' => 'Devices hosted across organizations', 'count' => 1], $deletion->blockers($organization));
        }
        // An organization of the account with no crossing leaves as before.
        $this->as($platform, fn () => $this->putJson('/api/v1/admin/organizations/'.$this->d->uuid.'/billing-account', ['billing_account_uuid' => $elsewhere->uuid])->assertNoContent());
    }

    public function test_an_organization_in_a_stopping_move_cannot_leave_the_account(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $this->confirm($this->a, $this->b, [$x])->assertAccepted();
        $platform = User::where('email', 'super-admin@example.test')->firstOrFail();
        $elsewhere = BillingAccount::create(['name' => 'Elsewhere billing']);

        $this->as($platform, fn () => $this->putJson('/api/v1/admin/organizations/'.$this->b->uuid.'/billing-account', ['billing_account_uuid' => $elsewhere->uuid])
            ->assertConflict()->assertJsonPath('hosted_devices.organizations', [['name' => 'Integrator', 'devices' => ['Tracker X']]]));
    }
}
