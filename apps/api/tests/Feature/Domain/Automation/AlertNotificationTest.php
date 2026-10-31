<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Automation;

use App\Domain\Authorization\Enums\OrganizationRoleName;
use App\Domain\Authorization\Models\Role;
use App\Domain\Automation\Jobs\DeliverAlertEmail;
use App\Domain\Automation\Models\Alert;
use App\Domain\Automation\Models\AlertDelivery;
use App\Domain\Automation\Models\Deployment;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Automation\Notifications\AlertTransitionNotification;
use App\Domain\Automation\Services\AlertProjector;
use App\Domain\Automation\Services\WorkflowDeploymentService;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Notifications\Services\Preferences;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Notifications\DatabaseNotification;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

/** Spec 022: the alert bell's notifications, written with each alert delivery and read per person and organization. */
final class AlertNotificationTest extends TestCase
{
    use RefreshDatabase;

    private Organization $org;

    private User $admin;

    private User $recipient;

    private User $colleague;

    private Device $device;

    private Workflow $workflow;

    private Deployment $deployment;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->admin = User::where('email', 'super-admin@example.test')->firstOrFail();
        $this->actingAs($this->admin, 'sanctum');
        $this->recipient = $this->verified('acme.member@example.test');
        $this->colleague = $this->verified('acme.moderator@example.test');
        $this->device = Device::create(['organization_id' => $this->org->id, 'code' => 'freezer-2', 'name' => 'Freezer 2', 'lifecycle' => 'active']);
        [$this->workflow, $this->deployment] = $this->automation($this->org, 'Cold room door open', ['binding' => ['device_uuid' => $this->device->uuid]]);
        config(['devices.runtime_token' => str_repeat('t', 40)]);
        Mail::fake();
    }

    private function verified(string $email): User
    {
        $user = User::where('email', $email)->firstOrFail();
        $user->forceFill(['email_verified_at' => now()])->save();

        return $user;
    }

    /**
     * @return array{0: Workflow, 1: Deployment}
     */
    private function automation(Organization $org, string $name, array $definition): array
    {
        $workflow = Workflow::create(['organization_id' => $org->id, 'name' => $name, 'workflow' => ['nodes' => []], 'definition' => $definition, 'definition_hash' => str_repeat('a', 64), 'updated_by' => $this->admin->id]);
        $deployment = Deployment::create(['automation_workflow_id' => $workflow->id, 'generation' => 1, 'draft_revision' => 1, 'target' => 'active', 'status' => 'succeeded', 'definition' => $definition, 'definition_hash' => str_repeat('a', 64), 'created_by' => $this->admin->id, 'created_at' => now()]);
        $workflow->update(['applied_deployment_uuid' => $deployment->uuid, 'desired_deployment_uuid' => $deployment->uuid, 'deployment_status' => 'applied']);

        return [$workflow, $deployment];
    }

    /**
     * @param  list<User>  $recipients
     */
    private function recipients(array $recipients, bool $clear = true, ?Workflow $workflow = null): void
    {
        $workflow ??= $this->workflow;
        $org = Organization::findOrFail($workflow->organization_id);
        $this->actingAs($this->admin, 'sanctum')
            ->putJson('/api/v1/organizations/'.$org->uuid.'/workflows/'.$workflow->uuid.'/notifications', ['revision' => $workflow->fresh()->notification_revision, 'enabled' => true, 'notify_on_clear' => $clear, 'recipient_ids' => array_map(fn (User $u) => $u->id, $recipients)])
            ->assertOk();
    }

    private function payload(string $type, int $episode, Workflow $workflow, Deployment $deployment): array
    {
        $org = Organization::findOrFail($workflow->organization_id);

        return ['rule_uuid' => $workflow->uuid, 'organization_uuid' => $org->uuid, 'operation_uuid' => $deployment->uuid, 'transition' => ['id' => hash('sha256', $deployment->uuid.':'.$episode.':'.$type), 'type' => $type, 'episode' => $episode, 'occurred_at' => now()->toIso8601String(), 'rule_uuid' => $workflow->uuid, 'organization_uuid' => $org->uuid, 'device_uuid' => $deployment->definition['binding']['device_uuid'] ?? null, 'version_uuid' => $deployment->uuid, 'definition_hash' => $deployment->definition_hash]];
    }

    private function transition(string $type, int $episode = 1, ?Workflow $workflow = null, ?Deployment $deployment = null): void
    {
        $payload = $this->payload($type, $episode, $workflow ?? $this->workflow, $deployment ?? $this->deployment);
        $this->withToken(str_repeat('t', 40))->postJson('/api/internal/devices/events', ['uuid' => (string) Str::uuid(), 'type' => 'workflow.transition.v1', 'payload' => $payload])->assertOk();
    }

    private function url(?Organization $org = null, string $path = ''): string
    {
        return '/api/v1/organizations/'.($org ?? $this->org)->uuid.'/alert-notifications'.$path;
    }

    /** @return Collection<int, DatabaseNotification> */
    private function bell(User $user)
    {
        return DatabaseNotification::where('notifiable_id', $user->id)->where('type', 'alert')->orderBy('id')->get();
    }

    private function alert(int $episode): Alert
    {
        return Alert::where('automation_deployment_id', $this->deployment->id)->where('episode', $episode)->firstOrFail();
    }

    public function test_each_recipient_gets_one_notification_per_transition_with_the_contract_data(): void
    {
        $this->freezeTime();
        $this->recipients([$this->recipient, $this->colleague]);
        $this->transition('activated');
        $this->transition('activated');

        $this->assertDatabaseCount('notifications', 2);
        $alert = $this->alert(1);
        $notification = $this->bell($this->recipient)->sole();
        $this->assertSame('alert', $notification->type);
        $this->assertSame($this->recipient->getMorphClass(), $notification->notifiable_type);
        $this->assertTrue(Str::isUuid($notification->id));
        $this->assertSame('7', $notification->id[14], 'UUIDv7 ids sort by time.');
        $this->assertEquals([
            'v' => 1,
            'source' => 'workflow',
            'organization_uuid' => $this->org->uuid,
            'alert_uuid' => $alert->uuid,
            'episode' => 1,
            'transition' => 'activated',
            'occurred_at' => now()->utc()->toIso8601ZuluString(),
            'workflow_uuid' => $this->workflow->uuid,
            'workflow_name' => 'Cold room door open',
            'device_uuid' => $this->device->uuid,
            'device_name' => 'Freezer 2',
        ], $notification->data);
        $this->assertSame(1, $notification->data['episode']);
        $this->assertCount(1, $this->bell($this->colleague));

        $this->transition('cleared');
        $this->transition('cleared');
        $this->assertSame(['activated', 'cleared'], $this->bell($this->recipient)->pluck('data.transition')->all());
        $this->assertSame(AlertDelivery::count(), DatabaseNotification::count());
    }

    public function test_cleared_notifications_need_recovery_on(): void
    {
        $this->recipients([$this->recipient], clear: false);
        $this->transition('activated');
        $this->transition('cleared');

        $this->assertSame(['activated'], $this->bell($this->recipient)->pluck('data.transition')->all());
    }

    public function test_no_notification_when_settings_are_off_the_execution_stopped_or_an_activation_comes_late(): void
    {
        $this->transition('activated');
        $this->assertDatabaseCount('notifications', 0);

        $this->recipients([$this->recipient]);
        $this->transition('cleared', 2);
        $this->transition('activated', 2);
        $this->assertDatabaseCount('notifications', 0);

        $this->deployment->update(['stopped_reason' => 'Stopped by a test.']);
        $this->transition('activated', 3);
        $this->assertDatabaseCount('notifications', 0);
    }

    public function test_the_bell_ignores_email_preferences(): void
    {
        DB::table('notification_preferences')->insert([
            'user_id' => $this->recipient->id, 'email_enabled' => false, 'revision' => 1,
            'grid' => json_encode(Preferences::view($this->recipient)['grid']),
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->recipients([$this->recipient]);
        $this->transition('activated');
        $delivery = AlertDelivery::firstOrFail();
        (new DeliverAlertEmail($delivery->uuid))->handle(app(DeviceAuthorization::class));

        Mail::assertNothingSent();
        $this->assertSame('cancelled', $delivery->fresh()->status);
        $this->assertCount(1, $this->bell($this->recipient));
    }

    public function test_a_failed_projection_rolls_back_the_notification_with_the_delivery(): void
    {
        $this->recipients([$this->recipient]);
        try {
            DB::transaction(function (): void {
                app(WorkflowDeploymentService::class)->event('workflow.transition.v1', $this->payload('activated', 1, $this->workflow, $this->deployment));
                $this->assertDatabaseCount('notifications', 1);
                throw new \RuntimeException('Force rollback');
            });
        } catch (\RuntimeException $e) {
            $this->assertSame('Force rollback', $e->getMessage());
        }

        $this->assertDatabaseCount('automation_alert_deliveries', 0);
        $this->assertDatabaseCount('notifications', 0);
    }

    public function test_dag_alerts_name_the_bound_device_and_an_unknown_device_is_left_out(): void
    {
        [$dag, $execution] = $this->automation($this->org, 'Too warm', ['schema_version' => 'automation-workflow.v2', 'bindings' => [['role' => 'sensor', 'device_uuid' => $this->device->uuid]]]);
        [$ghost, $ghostExecution] = $this->automation($this->org, 'Ghost', ['schema_version' => 'automation-workflow.v2', 'bindings' => [['role' => 'sensor', 'device_uuid' => (string) Str::uuid()]]]);
        $this->recipients([$this->recipient], workflow: $dag);
        $this->recipients([$this->recipient], workflow: $ghost);
        // DagActions projects alert actions without a device in the transition.
        DB::transaction(function () use ($dag, $execution, $ghost, $ghostExecution): void {
            app(AlertProjector::class)->project($dag->fresh(), $execution, ['id' => hash('sha256', 'dag'), 'type' => 'activated', 'episode' => 1, 'occurred_at' => now()->toIso8601String()]);
            app(AlertProjector::class)->project($ghost->fresh(), $ghostExecution, ['id' => hash('sha256', 'ghost'), 'type' => 'activated', 'episode' => 1, 'occurred_at' => now()->toIso8601String()]);
        });

        $this->actingAs($this->recipient, 'sanctum')->getJson($this->url())->assertOk()
            ->assertJsonPath('data.0.workflow.name', 'Ghost')
            ->assertJsonPath('data.0.device', null)
            ->assertJsonPath('data.1.workflow.name', 'Too warm')
            ->assertJsonPath('data.1.device', ['uuid' => $this->device->uuid, 'name' => 'Freezer 2']);
    }

    public function test_the_list_is_newest_first_twenty_a_page_with_the_unread_count_and_the_condition_now(): void
    {
        $this->recipients([$this->recipient]);
        foreach (range(1, 21) as $episode) {
            $this->transition('activated', $episode);
        }
        $this->actingAs($this->recipient, 'sanctum');

        $first = $this->getJson($this->url())->assertOk()
            ->assertJsonCount(20, 'data')
            ->assertJsonPath('meta.unread', 21)
            ->assertJsonPath('meta.total', 21)
            ->assertJsonPath('meta.last_page', 2)
            ->assertJsonPath('data.0.alert.episode', 21)
            ->assertJsonPath('data.0.alert.condition', 'active')
            ->assertJsonPath('data.0.transition', 'activated')
            ->assertJsonPath('data.0.read_at', null)
            ->assertJsonPath('data.0.workflow', ['uuid' => $this->workflow->uuid, 'name' => 'Cold room door open'])
            ->assertJsonPath('data.0.device', ['uuid' => $this->device->uuid, 'name' => 'Freezer 2']);
        $ids = collect($first->json('data'))->pluck('id');
        $this->assertSame($ids->sortDesc()->values()->all(), $ids->all());
        $this->getJson($this->url().'?page=2')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.alert.episode', 1);

        $this->transition('cleared', 21);
        $this->actingAs($this->recipient, 'sanctum')->getJson($this->url())->assertOk()
            ->assertJsonPath('meta.unread', 22)
            ->assertJsonPath('data.0.transition', 'cleared')
            ->assertJsonPath('data.0.alert.condition', 'cleared')
            ->assertJsonPath('data.1.transition', 'activated')
            ->assertJsonPath('data.1.alert.condition', 'cleared')
            ->assertJsonPath('data.2.alert.condition', 'active');
        $this->getJson($this->url().'?page=0')->assertUnprocessable();
    }

    public function test_a_connectivity_notification_names_its_kind_and_subject_and_no_workflow(): void
    {
        $this->recipients([$this->recipient]);
        $this->transition('activated');
        $alert = Alert::create(['organization_id' => $this->org->id, 'kind' => Alert::DEVICE_OFFLINE, 'severity' => 'critical', 'episode' => 1, 'episode_key' => 'device:'.$this->device->uuid.'#1', 'subject_device_id' => $this->device->id, 'activated_at' => now()]);
        // As spec 018 writes it (data-model "notifications"), for a person it notifies.
        $id = (string) Str::uuid7();
        DB::table('notifications')->insert(['id' => $id, 'type' => 'alert', 'notifiable_type' => $this->recipient->getMorphClass(), 'notifiable_id' => $this->recipient->id, 'read_at' => null, 'created_at' => now(), 'updated_at' => now(), 'data' => json_encode([
            'v' => 1, 'source' => 'connectivity', 'organization_uuid' => $this->org->uuid, 'alert_uuid' => $alert->uuid, 'episode' => 1, 'transition' => 'activated',
            'occurred_at' => now()->utc()->toIso8601ZuluString(), 'kind' => 'device_offline', 'subject' => ['type' => 'device', 'uuid' => $this->device->uuid, 'name' => 'Freezer 2'],
            'device_uuid' => $this->device->uuid, 'device_name' => 'Freezer 2', 'workflow_uuid' => null, 'workflow_name' => null,
        ])]);
        $this->actingAs($this->recipient, 'sanctum');

        $this->getJson($this->url())->assertOk()->assertJsonPath('meta.unread', 2)
            ->assertJsonPath('data.0.id', $id)->assertJsonPath('data.0.kind', 'device_offline')
            ->assertJsonPath('data.0.subject', ['type' => 'device', 'uuid' => $this->device->uuid, 'name' => 'Freezer 2'])
            ->assertJsonPath('data.0.workflow', null)->assertJsonPath('data.0.device', ['uuid' => $this->device->uuid, 'name' => 'Freezer 2'])
            ->assertJsonPath('data.0.alert', ['uuid' => $alert->uuid, 'episode' => 1, 'condition' => 'active'])
            ->assertJsonPath('data.1.kind', 'workflow')->assertJsonPath('data.1.subject', null)
            ->assertJsonPath('data.1.workflow', ['uuid' => $this->workflow->uuid, 'name' => 'Cold room door open']);
        $this->getJson($this->url(path: '/summary'))->assertOk()->assertJsonPath('data.newest_unread_activation_id', $id);
        $this->postJson($this->url(path: '/read'), ['alert_uuid' => $alert->uuid])->assertOk()->assertJsonPath('data.unread', 1);
    }

    public function test_the_summary_counts_unread_and_names_the_newest_unread_activation(): void
    {
        $this->recipients([$this->recipient]);
        $this->actingAs($this->recipient, 'sanctum')->getJson($this->url(path: '/summary'))->assertOk()
            ->assertExactJson(['data' => ['unread' => 0, 'newest_unread_activation_id' => null]]);
        $this->transition('activated', 1);
        $this->transition('activated', 2);
        $this->transition('cleared', 2);
        [$first, $second, $cleared] = $this->bell($this->recipient)->pluck('id')->all();

        $this->actingAs($this->recipient, 'sanctum')->getJson($this->url(path: '/summary'))->assertOk()
            ->assertExactJson(['data' => ['unread' => 3, 'newest_unread_activation_id' => $second]]);
        $this->postJson($this->url(path: '/read'), ['ids' => [$second]])->assertOk()
            ->assertExactJson(['data' => ['unread' => 2, 'newest_unread_activation_id' => $first]]);
        $this->postJson($this->url(path: '/read'), ['ids' => [$first]])->assertOk()
            ->assertExactJson(['data' => ['unread' => 1, 'newest_unread_activation_id' => null]]);
        $this->assertNull(DatabaseNotification::findOrFail($cleared)->read_at);
    }

    public function test_marking_read_by_ids_up_to_or_alert_touches_only_your_own_unread_notifications(): void
    {
        $this->recipients([$this->recipient, $this->colleague]);
        foreach (range(1, 4) as $episode) {
            $this->transition('activated', $episode);
        }
        $this->transition('cleared', 4);
        $mine = $this->bell($this->recipient)->pluck('id')->all();
        $theirs = $this->bell($this->colleague)->pluck('id')->all();
        $this->actingAs($this->recipient, 'sanctum');

        // Someone else's ids are ignored.
        $this->postJson($this->url(path: '/read'), ['ids' => [$mine[0], $theirs[1]]])->assertOk()->assertJsonPath('data.unread', 4);
        $this->assertSame(0, $this->bell($this->colleague)->whereNotNull('read_at')->count());

        // Mark all read up to what was shown: a later arrival stays unread.
        $this->postJson($this->url(path: '/read'), ['up_to' => $mine[2]])->assertOk()->assertJsonPath('data.unread', 2);
        $this->assertSame([$mine[3], $mine[4]], $this->bell($this->recipient)->whereNull('read_at')->pluck('id')->values()->all());

        // Opening an alert reads both of its transitions, and only them.
        $this->postJson($this->url(path: '/read'), ['alert_uuid' => $this->alert(4)->uuid])->assertOk()
            ->assertExactJson(['data' => ['unread' => 0, 'newest_unread_activation_id' => null]]);

        // Marking again keeps the first read time.
        $before = DatabaseNotification::findOrFail($mine[0])->read_at;
        $this->travel(10)->minutes();
        $this->postJson($this->url(path: '/read'), ['ids' => [$mine[0]]])->assertOk();
        $this->postJson($this->url(path: '/read'), ['up_to' => $mine[4]])->assertOk();
        $this->assertTrue($before->equalTo(DatabaseNotification::findOrFail($mine[0])->read_at));
        $this->assertSame(0, $this->bell($this->colleague)->whereNotNull('read_at')->count());
    }

    public function test_marking_read_takes_exactly_one_well_formed_choice(): void
    {
        $this->actingAs($this->recipient, 'sanctum');
        $read = $this->url(path: '/read');
        $id = (string) Str::uuid7();

        $this->postJson($read, [])->assertUnprocessable();
        $this->postJson($read, ['ids' => [$id], 'up_to' => $id])->assertUnprocessable();
        $this->postJson($read, ['up_to' => $id, 'alert_uuid' => $id])->assertUnprocessable();
        $this->postJson($read, ['ids' => []])->assertUnprocessable();
        $this->postJson($read, ['ids' => [$id, $id]])->assertUnprocessable();
        $this->postJson($read, ['ids' => ['not-a-uuid']])->assertUnprocessable();
        $this->postJson($read, ['ids' => array_map(fn () => (string) Str::uuid7(), range(1, 101))])->assertUnprocessable();
        $this->postJson($read, ['up_to' => 'nope'])->assertUnprocessable();
        $this->postJson($read, ['alert_uuid' => 12])->assertUnprocessable();
        $this->postJson($read, ['ids' => array_map(fn () => (string) Str::uuid7(), range(1, 100))])->assertOk();
    }

    public function test_a_person_in_two_organizations_sees_each_organizations_own_and_colleagues_see_none(): void
    {
        $operator = $this->verified('shared.operator@example.test');
        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        [$pump, $pumpExecution] = $this->automation($northstar, 'Pump pressure', ['binding' => ['device_uuid' => (string) Str::uuid()]]);
        $this->recipients([$operator]);
        $this->recipients([$operator], workflow: $pump);
        $this->transition('activated');
        $this->transition('activated', 1, $pump, $pumpExecution);
        [$acmeId, $northstarId] = $this->bell($operator)->pluck('id')->all();
        $this->actingAs($operator, 'sanctum');

        $this->getJson($this->url())->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $acmeId)->assertJsonPath('meta.unread', 1);
        $this->getJson($this->url($northstar))->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $northstarId);
        $this->getJson($this->url($northstar, '/summary'))->assertOk()->assertExactJson(['data' => ['unread' => 1, 'newest_unread_activation_id' => $northstarId]]);

        // Another organization's ids, and everything up to them, stay as they are.
        $this->postJson($this->url($northstar, '/read'), ['ids' => [$acmeId]])->assertOk()->assertJsonPath('data.unread', 1);
        $this->postJson($this->url($northstar, '/read'), ['up_to' => $northstarId])->assertOk()->assertJsonPath('data.unread', 0);
        $this->assertNull(DatabaseNotification::findOrFail($acmeId)->read_at);

        // A colleague in the same organization sees none of them and changes nothing.
        $this->actingAs($this->recipient, 'sanctum');
        $this->getJson($this->url())->assertOk()->assertJsonCount(0, 'data')->assertJsonPath('meta.unread', 0);
        $this->postJson($this->url(path: '/read'), ['ids' => [$acmeId]])->assertOk();
        $this->postJson($this->url(path: '/read'), ['alert_uuid' => $this->alert(1)->uuid])->assertOk();
        $this->assertNull(DatabaseNotification::findOrFail($acmeId)->read_at);
    }

    public function test_removed_members_are_refused_and_members_without_view_or_visiting_super_admins_see_nothing(): void
    {
        $this->recipients([$this->recipient]);
        $this->transition('activated');
        $id = $this->bell($this->recipient)->sole()->id;
        $empty = ['data' => ['unread' => 0, 'newest_unread_activation_id' => null]];

        // Lost Device.view: nothing shows and nothing is marked, until view returns.
        $member = Role::where('organization_id', $this->org->id)->where('name', OrganizationRoleName::MEMBER->value)->firstOrFail();
        $member->revokePermissionTo(DevicePermission::VIEW->value);
        $this->actingAs($this->recipient, 'sanctum');
        $this->getJson($this->url())->assertOk()->assertJsonCount(0, 'data')->assertJsonPath('meta.unread', 0)->assertJsonPath('meta.total', 0);
        $this->getJson($this->url(path: '/summary'))->assertOk()->assertExactJson($empty);
        $this->postJson($this->url(path: '/read'), ['ids' => [$id]])->assertOk()->assertExactJson($empty);
        $this->assertNull(DatabaseNotification::findOrFail($id)->read_at);
        $member->givePermissionTo(DevicePermission::VIEW->value);
        $this->getJson($this->url(path: '/summary'))->assertOk()->assertJsonPath('data.unread', 1);

        // A removed member cannot reach the organization at all.
        $this->recipient->organizations()->detach($this->org->id);
        $this->getJson($this->url())->assertForbidden();
        $this->getJson($this->url(path: '/summary'))->assertForbidden();
        $this->postJson($this->url(path: '/read'), ['ids' => [$id]])->assertForbidden();
        $this->assertNull(DatabaseNotification::findOrFail($id)->read_at);

        // A super administrator who is not a member gets an empty bell there.
        $this->assertFalse($this->admin->organizations()->whereKey($this->org->id)->exists());
        $this->admin->notify(new AlertTransitionNotification(['organization_uuid' => $this->org->uuid, 'alert_uuid' => $this->alert(1)->uuid, 'episode' => 1, 'transition' => 'activated', 'occurred_at' => now()->toIso8601ZuluString(), 'workflow_uuid' => $this->workflow->uuid, 'workflow_name' => 'Cold room door open', 'device_uuid' => null, 'device_name' => null]));
        $this->actingAs($this->admin, 'sanctum');
        $this->getJson($this->url())->assertOk()->assertJsonCount(0, 'data');
        $this->getJson($this->url(path: '/summary'))->assertOk()->assertExactJson($empty);
        $this->postJson($this->url(path: '/read'), ['up_to' => (string) Str::uuid7()])->assertOk();
        $this->assertNull($this->bell($this->admin)->sole()->read_at);
    }

    public function test_notifications_are_pruned_after_ninety_days(): void
    {
        $this->recipients([$this->recipient]);
        foreach (range(1, 3) as $episode) {
            $this->transition('activated', $episode);
        }
        [$old, $recent, $other] = $this->bell($this->recipient)->pluck('id')->all();
        DatabaseNotification::whereKey($old)->update(['created_at' => now()->subDays(91), 'read_at' => now()->subDays(90)]);
        DatabaseNotification::whereKey($recent)->update(['created_at' => now()->subDays(89)]);
        DatabaseNotification::whereKey($other)->update(['type' => 'something-else', 'created_at' => now()->subDays(200)]);

        $this->artisan('alerts:prune-notifications')->expectsOutput('Pruned 1 alert notifications.')->assertSuccessful();

        $this->assertSame([$recent, $other], DatabaseNotification::orderBy('id')->pluck('id')->all());
        $this->assertDatabaseCount('automation_alerts', 3);
    }
}
