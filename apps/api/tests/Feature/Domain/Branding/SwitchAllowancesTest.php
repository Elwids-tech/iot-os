<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Branding;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\BillingPlan;
use App\Domain\Billing\Services\Allowances;
use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** Branding, custom domains and the hidden "Powered by" line are on or off per billing account (spec 036 FR-035). */
final class SwitchAllowancesTest extends TestCase
{
    use RefreshDatabase;

    private User $administrator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->administrator = User::factory()->create(['is_super_admin' => true]);
    }

    public function test_the_switches_are_off_by_default(): void
    {
        $account = BillingAccount::factory()->create();

        foreach ([AllowanceKind::Branding, AllowanceKind::CustomDomain, AllowanceKind::HidePoweredBy] as $kind) {
            $resolved = app(Allowances::class)->resolve($account, $kind);
            $this->assertSame([0, 'default'], [$resolved->value, $resolved->source]);
            $this->assertFalse(app(Allowances::class)->allows($account, $kind));
        }
    }

    public function test_a_plan_and_an_override_each_turn_one_on(): void
    {
        $plan = BillingPlan::factory()->withAllowances(['branding' => 1])->create();
        $account = BillingAccount::factory()->onPlan($plan)->create();
        $allowances = app(Allowances::class);

        $this->assertSame([1, 'plan'], [$allowances->resolve($account, AllowanceKind::Branding)->value, $allowances->resolve($account, AllowanceKind::Branding)->source]);

        $detail = $this->actingAs($this->administrator, 'sanctum')
            ->putJson("/api/v1/admin/billing-accounts/{$account->uuid}/allowances/custom_domain", ['value' => 1, 'note' => 'Agreed'])
            ->assertOk()
            ->json('data.allowances');
        $byKind = collect($detail)->keyBy('kind');
        $this->assertSame(['kind' => 'branding', 'value' => 1, 'source' => 'plan', 'note' => null], $byKind['branding']);
        $this->assertSame(['kind' => 'custom_domain', 'value' => 1, 'source' => 'override', 'note' => 'Agreed'], $byKind['custom_domain']);
        $this->assertSame(['kind' => 'hide_powered_by', 'value' => 0, 'source' => 'default', 'note' => null], $byKind['hide_powered_by']);

        // The account's history words a switch as On and Off.
        $changes = collect($this->getJson("/api/v1/admin/billing-accounts/{$account->uuid}")->assertOk()->json('data.history'))->pluck('changes')->flatten(1);
        $this->assertContains(['field' => 'custom_domain', 'from' => 'Off', 'to' => 'On'], $changes->all());

        // An override can also turn off what the plan gives.
        $this->putJson("/api/v1/admin/billing-accounts/{$account->uuid}/allowances/branding", ['value' => 0, 'note' => 'Paused'])->assertOk();
        $this->assertFalse($allowances->allows($account, AllowanceKind::Branding));
        $this->deleteJson("/api/v1/admin/billing-accounts/{$account->uuid}/allowances/branding")->assertOk();
        $this->assertTrue($allowances->allows($account, AllowanceKind::Branding));
    }

    /**
     * @return array<string, array{mixed}>
     */
    public static function refusedValues(): array
    {
        return ['two' => [2], 'negative' => [-1], 'unlimited' => [null]];
    }

    #[DataProvider('refusedValues')]
    public function test_a_switch_takes_only_on_or_off(mixed $value): void
    {
        $account = BillingAccount::factory()->create();
        $this->actingAs($this->administrator, 'sanctum');

        $this->putJson("/api/v1/admin/billing-accounts/{$account->uuid}/allowances/branding", ['value' => $value, 'note' => 'Try'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('value');
        $this->postJson('/api/v1/admin/billing-plans', ['name' => 'Switch plan', 'allowances' => ['hide_powered_by' => $value]])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('allowances.hide_powered_by');
    }

    public function test_number_kinds_are_unchanged_and_owners_do_not_see_switches_as_limits(): void
    {
        $owner = User::factory()->create();
        $account = BillingAccount::factory()->ownedBy($owner)->create();
        $this->actingAs($this->administrator, 'sanctum');

        $this->putJson("/api/v1/admin/billing-accounts/{$account->uuid}/allowances/devices", ['value' => 80, 'note' => 'Rollout'])->assertOk();
        $this->putJson("/api/v1/admin/billing-accounts/{$account->uuid}/allowances/alerts", ['value' => null, 'note' => 'Pilot'])->assertOk();
        $this->assertSame(80, app(Allowances::class)->value($account, AllowanceKind::Devices));
        $this->assertNull(app(Allowances::class)->value($account, AllowanceKind::Alerts));

        $kinds = collect($this->actingAs($owner, 'sanctum')->getJson('/api/v1/billing-accounts')->assertOk()->json('data.0.allowances'))->pluck('kind');
        $this->assertEmpty($kinds->intersect(['branding', 'custom_domain', 'hide_powered_by']));
        $this->assertContains('devices', $kinds);
    }
}
