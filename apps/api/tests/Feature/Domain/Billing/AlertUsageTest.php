<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Billing;

use App\Domain\Automation\Models\Alert;
use App\Domain\Automation\Models\Deployment;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Automation\Services\AlertProjector;
use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\BillingPlan;
use App\Domain\Billing\Models\PlanAssignment;
use App\Domain\Billing\Services\Allowances;
use App\Domain\Billing\Services\PlanAssignments;
use App\Domain\Devices\Models\Device;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Carbon\CarbonImmutable;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Alerts count against the billing account's alert allowance (spec 028 US3, FR-012,
 * FR-017, FR-018): once per activation, in the UTC month the platform records it, and
 * past the allowance as overage against the plan assignment in force. Nothing about the
 * alert itself changes.
 */
final class AlertUsageTest extends TestCase
{
    use RefreshDatabase;

    private const TOKEN = 'alert-usage-runtime-token-000000000000000';

    private Organization $org;

    private BillingAccount $account;

    private User $admin;

    private User $recipient;

    private Device $device;

    private Workflow $workflow;

    private Deployment $deployment;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->account = $this->org->billingAccount;
        $this->admin = User::where('email', 'super-admin@example.test')->firstOrFail();
        $this->recipient = User::where('email', 'acme.member@example.test')->firstOrFail();
        $this->recipient->forceFill(['email_verified_at' => now()])->save();
        $this->device = Device::create(['organization_id' => $this->org->id, 'code' => 'freezer-2', 'name' => 'Freezer 2', 'lifecycle' => 'active']);
        [$this->workflow, $this->deployment] = $this->automation('Cold room door open', ['binding' => ['device_uuid' => $this->device->uuid]]);
        config(['devices.runtime_token' => self::TOKEN, 'devices.runtime_url' => 'http://runtime:8081']);
        Mail::fake();

        $this->actingAs($this->admin, 'sanctum')
            ->putJson('/api/v1/organizations/'.$this->org->uuid.'/workflows/'.$this->workflow->uuid.'/notifications', ['revision' => $this->workflow->fresh()->notification_revision, 'enabled' => true, 'notify_on_clear' => false, 'recipient_ids' => [$this->recipient->id]])
            ->assertOk();
    }

    public function test_four_activations_under_an_allowance_of_three_count_four_with_one_overage_and_every_alert_is_sent(): void
    {
        $assignment = $this->assign(3);

        foreach (range(1, 4) as $episode) {
            $this->transition('activated', $episode);
        }

        $this->assertUsage(4, 1);
        $this->assertSame(4, Alert::whereNotNull('activation_transition_id')->count());
        $this->assertSame(4, DB::table('automation_alert_deliveries')->where('type', 'activated')->where('recipient_id', $this->recipient->id)->count());
        $this->assertSame(4, DB::table('jobs')->where('queue', 'alerts')->where('payload', 'like', '%DeliverAlertEmail%')->count());
        $this->assertSame(
            [['organization_uuid' => $this->org->uuid, 'organization_id' => $this->org->id, 'organization_name' => 'Acme Manufacturing', 'count' => 4]],
            DB::table('billing_usage_shares')->where('billing_account_id', $this->account->id)->where('kind', 'alerts')->get()
                ->map(fn (object $share): array => ['organization_uuid' => $share->organization_uuid, 'organization_id' => (int) $share->organization_id, 'organization_name' => $share->organization_name, 'count' => (int) $share->count])
                ->all(),
        );
        $this->assertSame([[$assignment->id, 1]], $this->overageRows());
    }

    public function test_replayed_transitions_count_once_through_the_runtime_and_dag_actions(): void
    {
        $this->assign(10);

        $payload = $this->payload('activated', 1);
        $this->send($payload);
        $this->send($payload);
        $uuid = (string) Str::uuid();
        $this->send($payload, $uuid);
        $this->send($payload, $uuid);

        // DagActions hands an alert action to the projector with the action's id.
        [$dag, $execution] = $this->automation('Too warm', ['schema_version' => 'automation-workflow.v2', 'bindings' => [['role' => 'sensor', 'device_uuid' => $this->device->uuid]]]);
        $action = ['id' => hash('sha256', 'dag-action'), 'type' => 'activated', 'episode' => 1, 'occurred_at' => now()->toIso8601String()];
        DB::transaction(fn () => app(AlertProjector::class)->project($dag->fresh(), $execution, $action));
        DB::transaction(fn () => app(AlertProjector::class)->project($dag->fresh(), $execution, $action));

        $this->assertSame(2, Alert::count());
        $this->assertUsage(2, 0);
    }

    public function test_clears_acknowledgements_comments_and_offline_alerts_add_nothing(): void
    {
        $this->assign(10);
        $this->transition('activated', 1);
        $alert = Alert::firstOrFail();
        $url = '/api/v1/organizations/'.$this->org->uuid.'/alerts/'.$alert->uuid;

        $this->actingAs($this->admin, 'sanctum')->postJson($url.'/acknowledge')->assertOk();
        $this->postJson($url.'/comments', ['uuid' => (string) Str::uuid(), 'body' => 'Checking the door.'])->assertCreated();
        $this->putJson($url.'/assignee', ['user_id' => $this->recipient->id])->assertOk();
        $this->transition('cleared', 1);
        $this->withToken(self::TOKEN)->postJson('/api/internal/devices/events', ['uuid' => (string) Str::uuid(), 'type' => 'device.connectivity.v1', 'payload' => [
            'organization_uuid' => $this->org->uuid,
            'subject' => ['kind' => 'device', 'device_uuid' => $this->device->uuid, 'connection_uuid' => null, 'edge_node_id' => null, 'adapter_uuid' => null],
            'episode' => 1, 'transition' => 'opened', 'cause' => 'missed_check_in',
            'offline_since' => '2026-11-06T10:00:00Z', 'at' => '2026-11-06T10:02:00Z',
            'last_heard_at' => '2026-11-06T09:45:00Z', 'last_observed_at' => '2026-11-06T09:44:58Z',
            'offline_after_seconds' => 900, 'offline_after_automatic' => true, 'reporting_interval_seconds' => 120, 'poll_interval_seconds' => 300,
            'grace_seconds' => 120, 'settings_generation' => 0, 'affected_device_uuids' => [$this->device->uuid], 'stop_reason' => null,
        ]])->assertOk();

        $this->assertSame(1, Alert::where('kind', Alert::DEVICE_OFFLINE)->count());
        $this->assertUsage(1, 0);
    }

    public function test_alerts_count_in_the_utc_month_the_platform_records_them(): void
    {
        $this->assign(1);
        $this->travelTo(CarbonImmutable::parse('2026-11-30 23:59:30', 'UTC'));
        $this->transition('activated', 1);
        $this->travelTo(CarbonImmutable::parse('2026-12-01 00:00:30', 'UTC'));
        // Reported late: it occurred in November but counts in December, so November never changes.
        $this->send($this->payload('activated', 2, occurredAt: '2026-11-30T23:59:50Z'));

        $this->assertUsage(1, 0, '2026-11-01');
        $this->assertUsage(1, 0, '2026-12-01');
        $this->getJson('/api/v1/admin/billing-accounts/'.$this->account->uuid.'/usage?month=2026-11')
            ->assertOk()
            ->assertJsonPath('data.0.kind', 'alerts')
            ->assertJsonPath('data.0.month', '2026-11-01')
            ->assertJsonPath('data.0.count', 1)
            // The allowance may have changed since: an earlier month leaves out what was left (FR-023).
            ->assertJsonPath('data.0.left', null);
        $this->getJson('/api/v1/admin/billing-accounts/'.$this->account->uuid.'/usage')->assertOk()->assertJsonPath('data.0.left', 0);
    }

    public function test_a_plan_change_mid_month_applies_to_what_is_left(): void
    {
        $this->assign(3);
        $this->transition('activated', 1);
        $this->transition('activated', 2);

        // Lowered below what is used: the next alert is overage, nothing is undone.
        $lowered = $this->assign(1);
        $this->transition('activated', 3);
        $this->assertUsage(3, 1);

        // Raised: what is left grows, and the recorded overage stays.
        $this->assign(10);
        $this->transition('activated', 4);
        $this->assertUsage(4, 1);
        $this->assertSame([[$lowered->id, 1]], $this->overageRows());
    }

    public function test_overage_rows_name_the_assignment_in_force_or_no_plan(): void
    {
        // No plan: an override of 0 makes every alert overage, recorded against no assignment.
        app(Allowances::class)->override($this->account, AllowanceKind::Alerts, 0, 'Pilot terms', $this->admin);
        $this->transition('activated', 1);
        $this->transition('activated', 2);

        $plan = BillingPlan::factory()->withAllowances(['alerts' => 5])->create();
        $assignment = app(PlanAssignments::class)->assign($this->account, $plan, $this->admin);
        // The override still applies over the plan.
        $this->transition('activated', 3);

        $this->assertUsage(3, 3);
        $this->assertSame([[null, 2], [$assignment->id, 1]], $this->overageRows());
    }

    public function test_unlimited_alerts_are_counted_without_overage(): void
    {
        foreach (range(1, 3) as $episode) {
            $this->transition('activated', $episode);
        }

        $this->assertUsage(3, 0);
        $this->assertSame([], $this->overageRows());
        $this->assertSame(0, DB::table('billing_notices')->count());
    }

    private function assign(int $alerts): PlanAssignment
    {
        $plan = BillingPlan::factory()->withAllowances(['alerts' => $alerts])->create();

        return app(PlanAssignments::class)->assign($this->account, $plan, $this->admin);
    }

    private function assertUsage(int $count, int $overage, ?string $month = null): void
    {
        $row = DB::table('billing_usage')
            ->where('billing_account_id', $this->account->id)
            ->where('kind', 'alerts')
            ->where('month', $month ?? now()->utc()->startOfMonth()->toDateString())
            ->first();

        $this->assertSame([$count, $overage], [(int) $row?->count, (int) $row?->overage]);
    }

    /**
     * @return list<array{0: int|null, 1: int}>
     */
    private function overageRows(): array
    {
        return DB::table('billing_overage')
            ->where('billing_account_id', $this->account->id)
            ->where('kind', 'alerts')
            ->orderByRaw('plan_assignment_id IS NOT NULL')
            ->orderBy('plan_assignment_id')
            ->get()
            ->map(fn (object $row): array => [$row->plan_assignment_id === null ? null : (int) $row->plan_assignment_id, (int) $row->quantity])
            ->all();
    }

    /**
     * @return array{0: Workflow, 1: Deployment}
     */
    private function automation(string $name, array $definition): array
    {
        $workflow = Workflow::create(['organization_id' => $this->org->id, 'name' => $name, 'workflow' => ['nodes' => []], 'definition' => $definition, 'definition_hash' => str_repeat('a', 64), 'updated_by' => $this->admin->id]);
        $deployment = Deployment::create(['automation_workflow_id' => $workflow->id, 'generation' => 1, 'draft_revision' => 1, 'target' => 'active', 'status' => 'succeeded', 'definition' => $definition, 'definition_hash' => str_repeat('a', 64), 'created_by' => $this->admin->id, 'created_at' => now()]);
        $workflow->update(['applied_deployment_uuid' => $deployment->uuid, 'desired_deployment_uuid' => $deployment->uuid, 'deployment_status' => 'applied']);

        return [$workflow, $deployment];
    }

    private function payload(string $type, int $episode, ?string $occurredAt = null): array
    {
        return ['rule_uuid' => $this->workflow->uuid, 'organization_uuid' => $this->org->uuid, 'operation_uuid' => $this->deployment->uuid, 'transition' => ['id' => hash('sha256', $this->deployment->uuid.':'.$episode.':'.$type), 'type' => $type, 'episode' => $episode, 'occurred_at' => $occurredAt ?? now()->toIso8601String(), 'rule_uuid' => $this->workflow->uuid, 'organization_uuid' => $this->org->uuid, 'device_uuid' => $this->device->uuid, 'version_uuid' => $this->deployment->uuid, 'definition_hash' => $this->deployment->definition_hash]];
    }

    private function transition(string $type, int $episode): void
    {
        $this->send($this->payload($type, $episode));
    }

    private function send(array $payload, ?string $uuid = null): void
    {
        $this->withToken(self::TOKEN)->postJson('/api/internal/devices/events', ['uuid' => $uuid ?? (string) Str::uuid(), 'type' => 'workflow.transition.v1', 'payload' => $payload])->assertOk();
    }
}
