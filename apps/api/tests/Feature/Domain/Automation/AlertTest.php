<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Automation;

use App\Domain\Automation\Jobs\DeliverAlertEmail;
use App\Domain\Automation\Mail\AlertEmail;
use App\Domain\Automation\Models\Alert;
use App\Domain\Automation\Models\AlertDelivery;
use App\Domain\Automation\Models\Deployment;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Automation\Services\WorkflowDeploymentService;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Notifications\Services\Preferences;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

final class AlertTest extends TestCase
{
    use RefreshDatabase;

    private Organization $org;

    private Workflow $workflow;

    private Deployment $deployment;

    private User $recipient;

    private string $base;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $actor = User::where('email', 'super-admin@example.test')->firstOrFail();
        $this->actingAs($actor, 'sanctum');
        $this->recipient = User::where('email', 'acme.member@example.test')->firstOrFail();
        $this->recipient->forceFill(['email_verified_at' => now()])->save();
        $definition = ['binding' => ['device_uuid' => (string) Str::uuid()]];
        $this->workflow = Workflow::create(['organization_id' => $this->org->id, 'name' => 'North paddock', 'workflow' => ['nodes' => []], 'definition' => $definition, 'definition_hash' => str_repeat('a', 64), 'updated_by' => $actor->id]);
        $this->deployment = Deployment::create(['automation_workflow_id' => $this->workflow->id, 'generation' => 1, 'draft_revision' => 1, 'target' => 'active', 'status' => 'succeeded', 'definition' => $definition, 'definition_hash' => str_repeat('a', 64), 'created_by' => $actor->id, 'created_at' => now()]);
        $this->workflow->update(['applied_deployment_uuid' => $this->deployment->uuid, 'desired_deployment_uuid' => $this->deployment->uuid, 'deployment_status' => 'applied']);
        $this->base = '/api/v1/organizations/'.$this->org->uuid;
        config(['devices.runtime_token' => str_repeat('t', 40)]);
        Mail::fake();
    }

    private function settings(bool $clear = true): void
    {
        $this->putJson($this->base.'/workflows/'.$this->workflow->uuid.'/notifications', ['revision' => 0, 'enabled' => true, 'notify_on_clear' => $clear, 'recipient_ids' => [$this->recipient->id]])->assertOk();
    }

    private function payload(string $type, int $episode = 1): array
    {
        return ['rule_uuid' => $this->workflow->uuid, 'organization_uuid' => $this->org->uuid, 'operation_uuid' => $this->deployment->uuid, 'transition' => ['id' => hash('sha256', $this->deployment->uuid.':'.$episode.':'.$type), 'type' => $type, 'episode' => $episode, 'occurred_at' => now()->toIso8601String(), 'rule_uuid' => $this->workflow->uuid, 'organization_uuid' => $this->org->uuid, 'device_uuid' => $this->deployment->definition['binding']['device_uuid'], 'version_uuid' => $this->deployment->uuid, 'definition_hash' => $this->deployment->definition_hash]];
    }

    private function transition(string $type, int $episode = 1): void
    {
        $this->withToken(str_repeat('t', 40))->postJson('/api/internal/devices/events', ['uuid' => (string) Str::uuid(), 'type' => 'workflow.transition.v1', 'payload' => $this->payload($type, $episode)])->assertOk();
    }

    private function deliver(AlertDelivery $delivery): void
    {
        (new DeliverAlertEmail($delivery->uuid))->handle(app(DeviceAuthorization::class));
    }

    public function test_personal_email_opt_out_preserves_workflow_events_and_cancels_pending_mail(): void
    {
        $this->settings();
        $this->transition('activated');
        $delivery = AlertDelivery::firstOrFail();
        DB::table('notification_preferences')->insert([
            'user_id' => $this->recipient->id, 'email_enabled' => false, 'revision' => 1,
            'grid' => json_encode(Preferences::view($this->recipient)['grid']),
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->deliver($delivery);
        Mail::assertNothingSent();
        $this->assertSame('cancelled', $delivery->fresh()->status);
        $this->assertDatabaseCount('notification_events', 1);
        $this->assertDatabaseCount('automation_alerts', 1);
    }

    public function test_episode_projection_deduplication_acknowledgement_and_comments(): void
    {
        $this->transition('activated');
        $this->transition('activated');
        $this->assertDatabaseCount('automation_alerts', 1);
        $this->assertDatabaseCount('jobs', 0);
        $alert = Alert::firstOrFail();
        $url = $this->base.'/alerts/'.$alert->uuid;
        $this->postJson($url.'/acknowledge')->assertOk()->assertJsonPath('data.condition', 'active');
        $firstAck = $alert->fresh()->acknowledged_at;
        $this->postJson($url.'/acknowledge')->assertOk();
        $this->assertTrue($firstAck->equalTo($alert->fresh()->acknowledged_at));
        $comment = ['uuid' => (string) Str::uuid(), 'body' => 'Checking the boundary.'];
        $this->postJson($url.'/comments', $comment)->assertCreated();
        $this->postJson($url.'/comments', $comment)->assertCreated();
        $this->postJson($url.'/comments', [...$comment, 'body' => 'Changed'])->assertConflict();
        $this->getJson($url.'/comments')->assertJsonPath('meta.total', 1);
        $this->transition('cleared');
        $this->getJson($url)->assertJsonPath('data.condition', 'cleared')->assertJsonPath('data.episode', 1);
        $this->assertNotNull($alert->fresh()->acknowledged_at);
        $this->transition('activated', 2);
        $this->getJson($this->base.'/alerts?condition=active&acknowledged=0')->assertJsonPath('meta.total', 1);
        Mail::assertNothingSent();
    }

    public function test_queue_and_alert_commit_atomically_and_clear_first_does_not_reopen(): void
    {
        $this->settings();
        try {
            DB::transaction(function (): void {
                app(WorkflowDeploymentService::class)->event('workflow.transition.v1', $this->payload('activated'));
                $this->assertDatabaseCount('jobs', 1);
                throw new \RuntimeException('Force rollback');
            });
        } catch (\RuntimeException $e) {
            $this->assertSame('Force rollback', $e->getMessage());
        }
        $this->assertDatabaseCount('automation_alerts', 0);
        $this->assertDatabaseCount('automation_alert_deliveries', 0);
        $this->assertDatabaseCount('jobs', 0);
        $this->transition('cleared');
        $this->transition('activated');
        $this->assertDatabaseCount('automation_alerts', 1);
        $this->assertNotNull(Alert::firstOrFail()->cleared_at);
        $this->assertDatabaseCount('jobs', 0);
    }

    public function test_email_is_deduplicated_with_optional_recovery_and_attempt_history(): void
    {
        $this->settings();
        $this->transition('activated');
        $this->transition('activated');
        $this->assertDatabaseCount('jobs', 1);
        $delivery = AlertDelivery::firstOrFail();
        $this->deliver($delivery);
        $this->deliver($delivery);
        Mail::assertSent(AlertEmail::class, 1);
        $this->assertSame('sent', $delivery->fresh()->status);
        $this->transition('cleared');
        $clear = AlertDelivery::where('type', 'cleared')->firstOrFail();
        $this->deliver($clear);
        Mail::assertSent(AlertEmail::class, 2);
        $this->assertDatabaseCount('automation_alert_delivery_attempts', 2);
        $this->getJson($this->base.'/alerts/'.Alert::firstOrFail()->uuid.'/deliveries')->assertOk()->assertJsonPath('data.0.status', 'sent');
    }

    public function test_email_names_the_device_and_links_to_the_alert_and_its_automation(): void
    {
        config(['app.frontend_url' => 'https://portal.example.test/']);
        Device::create(['uuid' => $this->deployment->definition['binding']['device_uuid'], 'organization_id' => $this->org->id, 'code' => 'tractor-7', 'name' => 'Tractor 7']);
        $this->settings();
        $this->transition('activated');
        $this->deliver(AlertDelivery::firstOrFail());
        $alert = Alert::firstOrFail();
        $portal = 'https://portal.example.test/organizations/'.$this->org->uuid;
        Mail::assertSent(AlertEmail::class, function (AlertEmail $mail) use ($alert, $portal): bool {
            $mail->assertHasSubject('IoT alert active: North paddock — Tractor 7');
            $mail->assertSeeInText('Device: Tractor 7');
            $mail->assertSeeInText('Organization: '.$this->org->name);
            $mail->assertSeeInText('Open this alert: '.$portal.'/alerts/'.$alert->uuid);
            $mail->assertSeeInText('Open the automation: '.$portal.'/automation/'.$this->workflow->uuid);
            $mail->assertSeeInText($portal.'/settings/notifications');

            return true;
        });
    }

    public function test_transport_retries_are_recorded_and_bounded(): void
    {
        $this->settings();
        $this->transition('activated');
        $delivery = AlertDelivery::firstOrFail();
        Mail::shouldReceive('to')->times(5)->andThrow(new \RuntimeException('SMTP unavailable'));
        for ($attempt = 1; $attempt <= 5; $attempt++) {
            try {
                $this->deliver($delivery);
            } catch (\RuntimeException $e) {
                $this->assertSame('Alert email transport failed; retry scheduled.', $e->getMessage());
            }
            $this->assertSame($attempt, (int) $delivery->fresh()->attempts);
        }
        $this->assertSame('failed', $delivery->fresh()->status);
        $this->assertDatabaseCount('automation_alert_delivery_attempts', 5);
        $this->deliver($delivery);
        $this->assertSame(5, (int) $delivery->fresh()->attempts);
    }

    public function test_removed_access_or_disabled_settings_cancel_pending_delivery(): void
    {
        $this->settings();
        $this->transition('activated');
        $delivery = AlertDelivery::firstOrFail();
        $this->recipient->organizations()->detach($this->org->id);
        $this->deliver($delivery);
        $this->assertSame('cancelled', $delivery->fresh()->status);
        Mail::assertNothingSent();
    }

    public function test_cleared_and_disabled_executions_do_not_send_stale_activation_email(): void
    {
        $this->settings(false);
        $this->transition('activated');
        $this->transition('cleared');
        $this->deliver(AlertDelivery::firstOrFail());
        $this->assertSame('cancelled', AlertDelivery::firstOrFail()->status);
        $this->transition('activated', 2);
        $this->workflow->update(['desired_deployment_uuid' => null]);
        $this->deliver(AlertDelivery::latest('id')->firstOrFail());
        Mail::assertNothingSent();
    }

    public function test_scope_permissions_and_notification_revision(): void
    {
        $this->transition('activated');
        $alert = Alert::firstOrFail();
        $other = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $foreign = '/api/v1/organizations/'.$other->uuid.'/alerts/'.$alert->uuid;
        $this->getJson($foreign)->assertNotFound();
        $this->postJson($foreign.'/acknowledge')->assertNotFound();
        $this->postJson($foreign.'/comments', [])->assertNotFound();
        $settings = $this->base.'/workflows/'.$this->workflow->uuid.'/notifications';
        $this->getJson($settings)->assertJsonPath('data.enabled', false);
        $this->settings();
        $this->putJson($settings, ['revision' => 0, 'enabled' => false, 'notify_on_clear' => false, 'recipient_ids' => []])->assertConflict();
        $this->putJson($settings, ['revision' => 1, 'enabled' => true, 'notify_on_clear' => false, 'recipient_ids' => [User::where('email', 'super-admin@example.test')->firstOrFail()->id]])->assertUnprocessable();
        $this->actingAs($this->recipient, 'sanctum');
        $this->getJson($this->base.'/alerts/'.$alert->uuid)->assertOk();
        $this->postJson($this->base.'/alerts/'.$alert->uuid.'/acknowledge')->assertForbidden();
        $this->getJson($settings)->assertForbidden();
        $this->getJson($this->base.'/alerts/'.$alert->uuid.'/deliveries')->assertForbidden();
    }

    public function test_manual_retry_preserves_history_and_fences_old_jobs(): void
    {
        $this->settings();
        $this->transition('activated');
        $delivery = AlertDelivery::firstOrFail();
        $delivery->update(['status' => 'failed', 'attempts' => 5, 'cycle_attempts' => 5]);
        DB::table('automation_alert_delivery_attempts')->insert(['automation_alert_delivery_id' => $delivery->id, 'attempt' => 5, 'status' => 'transport_failed', 'created_at' => now()]);
        $url = $this->base.'/alerts/'.Alert::firstOrFail()->uuid.'/deliveries/'.$delivery->uuid.'/retry';
        $this->postJson($url, ['retry_generation' => 0])->assertAccepted();
        $this->postJson($url, ['retry_generation' => 0])->assertConflict();
        $this->assertDatabaseCount('jobs', 2);
        $this->deliver($delivery); // Original generation cannot send or fail new work.
        (new DeliverAlertEmail($delivery->uuid))->failed(null);
        Mail::assertNothingSent();
        $this->assertSame('pending', $delivery->fresh()->status);
        (new DeliverAlertEmail($delivery->uuid, 1))->handle(app(DeviceAuthorization::class));
        Mail::assertSent(AlertEmail::class, 1);
        $this->assertSame(6, (int) $delivery->fresh()->attempts);
        $this->assertSame(1, (int) $delivery->fresh()->cycle_attempts);
        $this->assertDatabaseCount('automation_alert_delivery_attempts', 2);
        $this->postJson($url, ['retry_generation' => 1])->assertConflict();
    }

    public function test_retry_is_scoped_and_rechecks_current_subscription(): void
    {
        $this->settings();
        $this->transition('activated');
        $alert = Alert::firstOrFail();
        $delivery = AlertDelivery::firstOrFail();
        $delivery->update(['status' => 'failed']);
        $suffix = '/alerts/'.$alert->uuid.'/deliveries/'.$delivery->uuid.'/retry';
        $other = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $this->postJson('/api/v1/organizations/'.$other->uuid.$suffix, ['retry_generation' => 0])->assertNotFound();
        $this->postJson($this->base.'/alerts/'.$alert->uuid.'/deliveries/'.Str::uuid().'/retry', ['retry_generation' => 0])->assertNotFound();
        $this->postJson($this->base.$suffix, ['retry_generation' => 0])->assertAccepted();
        $this->workflow->update(['notification_settings' => ['enabled' => false]]);
        (new DeliverAlertEmail($delivery->uuid, 1))->handle(app(DeviceAuthorization::class));
        $this->assertSame('cancelled', $delivery->fresh()->status);
        Mail::assertNothingSent();
        $this->actingAs($this->recipient, 'sanctum');
        $this->postJson($this->base.$suffix, ['retry_generation' => 1])->assertForbidden();
    }

    /**
     * Postgres rejects a malformed uuid with a 500, which SQLite never does, so the test also proves the
     * request stopped before any alert query.
     */
    public function test_returns_404_without_querying_alerts_when_an_alert_or_delivery_id_is_not_a_uuid(): void
    {
        $alert = $this->episode($this->deployment, 1);
        DB::enableQueryLog();

        $this->getJson($this->base.'/alerts/not-a-uuid')->assertNotFound();
        $this->getJson($this->base.'/alerts/settings/comments?page=1')->assertNotFound();
        $this->getJson($this->base.'/alerts/settings/deliveries')->assertNotFound();
        $this->postJson($this->base.'/alerts/not-a-uuid/acknowledge')->assertNotFound();
        $this->postJson($this->base.'/alerts/'.$alert->uuid.'/deliveries/not-a-uuid/retry', ['retry_generation' => 0])->assertNotFound();

        $alertQueries = array_filter(DB::getQueryLog(), fn (array $query): bool => str_contains($query['query'], 'automation_alert'));
        $this->assertSame([], $alertQueries);
    }

    public function test_list_and_detail_name_device_acknowledger_and_assignee_and_filter_by_device_and_workflow(): void
    {
        $deviceUuid = $this->deployment->definition['binding']['device_uuid'];
        Device::create(['uuid' => $deviceUuid, 'organization_id' => $this->org->id, 'code' => 'tractor-7', 'name' => 'Tractor 7']);
        $this->transition('activated');
        $alert = Alert::firstOrFail();
        $this->postJson($this->base.'/alerts/'.$alert->uuid.'/acknowledge')->assertOk();
        $otherWorkflow = Workflow::create(['organization_id' => $this->org->id, 'name' => 'South gate', 'workflow' => ['nodes' => []], 'definition' => [], 'definition_hash' => str_repeat('b', 64), 'updated_by' => $this->workflow->updated_by]);
        $otherDeployment = Deployment::create(['automation_workflow_id' => $otherWorkflow->id, 'generation' => 1, 'draft_revision' => 1, 'target' => 'active', 'status' => 'succeeded', 'definition' => ['binding' => ['device_uuid' => (string) Str::uuid()]], 'created_by' => $this->workflow->updated_by, 'created_at' => now()]);
        $unnamed = Alert::create(['organization_id' => $this->org->id, 'automation_workflow_id' => $otherWorkflow->id, 'automation_deployment_id' => $otherDeployment->id, 'episode' => 1, 'activated_at' => now()]);
        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $foreignWorkflow = Workflow::create(['organization_id' => $northstar->id, 'name' => 'Foreign', 'workflow' => ['nodes' => []], 'definition' => [], 'definition_hash' => str_repeat('c', 64), 'updated_by' => $this->workflow->updated_by]);
        $foreignDeployment = Deployment::create(['automation_workflow_id' => $foreignWorkflow->id, 'generation' => 1, 'draft_revision' => 1, 'target' => 'active', 'status' => 'succeeded', 'definition' => ['binding' => ['device_uuid' => $deviceUuid]], 'created_by' => $this->workflow->updated_by, 'created_at' => now()]);
        Alert::create(['organization_id' => $northstar->id, 'automation_workflow_id' => $foreignWorkflow->id, 'automation_deployment_id' => $foreignDeployment->id, 'episode' => 1, 'activated_at' => now()]);

        $this->getJson($this->base.'/alerts')->assertOk()->assertJsonPath('meta.total', 2)
            ->assertJsonPath('data.0.uuid', $unnamed->uuid)->assertJsonPath('data.0.device_name', null)->assertJsonPath('data.0.acknowledged_by_name', null)
            ->assertJsonPath('data.1.device_uuid', $deviceUuid)->assertJsonPath('data.1.device_name', 'Tractor 7')
            ->assertJsonPath('data.1.acknowledged_by_name', 'Platform Super Admin')->assertJsonPath('data.1.assignee', null);
        $this->getJson($this->base.'/alerts/'.$alert->uuid)->assertJsonPath('data.device_name', 'Tractor 7')->assertJsonPath('data.acknowledged_by_name', 'Platform Super Admin');
        $this->getJson($this->base.'/alerts?device='.$deviceUuid)->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.uuid', $alert->uuid);
        $this->getJson($this->base.'/alerts?workflow='.$otherWorkflow->uuid)->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.uuid', $unnamed->uuid);
        $this->getJson($this->base.'/alerts?workflow='.$foreignWorkflow->uuid)->assertJsonPath('meta.total', 0);
        $this->getJson($this->base.'/alerts?device='.Str::uuid())->assertJsonPath('meta.total', 0);
        $this->getJson($this->base.'/alerts?device=tractor-7')->assertUnprocessable()->assertJsonValidationErrors('device');
        $this->getJson($this->base.'/alerts?workflow=1')->assertUnprocessable()->assertJsonValidationErrors('workflow');
    }

    public function test_assignment_requires_manage_and_an_organization_member(): void
    {
        $this->transition('activated');
        $alert = Alert::firstOrFail();
        $url = $this->base.'/alerts/'.$alert->uuid.'/assignee';
        $this->putJson($url, ['user_id' => $this->recipient->id])->assertOk()
            ->assertJsonPath('data.assignee', ['id' => $this->recipient->id, 'name' => $this->recipient->name]);
        $this->assertNotNull($alert->fresh()->assigned_at);
        $this->assertDatabaseHas('activity_log', ['event' => 'alert.assigned', 'subject_uuid' => $alert->uuid]);
        $this->getJson($this->base.'/alerts')->assertJsonPath('data.0.assignee.name', $this->recipient->name);
        $this->getJson($this->base.'/alerts?assignee='.$this->recipient->id)->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.uuid', $alert->uuid);
        $this->getJson($this->base.'/alerts?assignee='.($this->recipient->id + 1000))->assertJsonPath('meta.total', 0);
        $this->getJson($this->base.'/alerts?assignee=me')->assertUnprocessable()->assertJsonValidationErrors('assignee');
        $outsider = User::where('email', 'northstar.member@example.test')->firstOrFail();
        $this->putJson($url, ['user_id' => $outsider->id])->assertUnprocessable()->assertJsonValidationErrors('user_id');
        $this->putJson($url, [])->assertUnprocessable()->assertJsonValidationErrors('user_id');
        $this->assertSame($this->recipient->id, (int) $alert->fresh()->assigned_to);
        $other = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $this->putJson('/api/v1/organizations/'.$other->uuid.'/alerts/'.$alert->uuid.'/assignee', ['user_id' => null])->assertNotFound();
        $this->putJson($url, ['user_id' => null])->assertOk()->assertJsonPath('data.assignee', null)->assertJsonPath('data.assigned_at', null);
        $this->actingAs($this->recipient, 'sanctum');
        $this->putJson($url, ['user_id' => $this->recipient->id])->assertForbidden();
        $this->assertNull($alert->fresh()->assigned_to);
    }

    public function test_assignment_rejects_deleted_and_platform_only_users_and_clears_when_the_assignee_is_deleted(): void
    {
        $this->transition('activated');
        $alert = Alert::firstOrFail();
        $url = $this->base.'/alerts/'.$alert->uuid.'/assignee';
        $platformAdmin = User::where('email', 'super-admin@example.test')->firstOrFail();
        $this->assertFalse($platformAdmin->organizations()->whereKey($this->org->id)->exists());
        $this->putJson($url, ['user_id' => $platformAdmin->id])->assertUnprocessable()->assertJsonValidationErrors('user_id');
        $leaver = User::factory()->create();
        $leaver->organizations()->attach($this->org->id);
        $this->putJson($url, ['user_id' => $leaver->id])->assertOk()->assertJsonPath('data.assignee.id', $leaver->id);

        $leaver->delete();
        $this->assertNull($alert->fresh()->assigned_to);
        $this->getJson($this->base.'/alerts/'.$alert->uuid)->assertJsonPath('data.assignee', null);
        $this->putJson($url, ['user_id' => $leaver->id])->assertUnprocessable()->assertJsonValidationErrors('user_id');
    }

    public function test_settings_return_selected_names_and_reject_stale_edits(): void
    {
        $this->settings();
        $url = $this->base.'/workflows/'.$this->workflow->uuid;
        $this->getJson($url.'/notifications')->assertOk()->assertJsonPath('data.recipients.0.name', $this->recipient->name);
        $this->getJson($url.'/notification-recipients?search=')->assertOk();
        $this->getJson($url.'/notification-recipients?search='.urlencode($this->recipient->name))->assertOk()->assertJsonPath('data.0.id', $this->recipient->id);
        $this->putJson($url.'/notifications', ['revision' => 0, 'enabled' => false, 'notify_on_clear' => false, 'recipient_ids' => []])->assertConflict();
        $this->getJson($url.'/notifications')->assertJsonPath('data.enabled', true);
    }

    public function test_the_workflow_list_adds_dag_automations_only_when_asked(): void
    {
        $actor = $this->workflow->updated_by;
        $geofence = Workflow::create(['organization_id' => $this->org->id, 'name' => 'Paddock boundary', 'workflow' => ['schema_version' => 'automation-workflow.v1', 'nodes' => [['id' => 'source', 'type' => 'location.source.v1', 'config' => []]], 'edges' => []], 'definition' => [], 'definition_hash' => str_repeat('b', 64), 'updated_by' => $actor]);
        $dag = ['schema_version' => 'automation-workflow.v2', 'bindings' => [], 'nodes' => [['id' => 'source', 'type' => 'source.parameter.v1', 'config' => ['binding' => 'pump']]], 'edges' => []];
        $automation = Workflow::create(['organization_id' => $this->org->id, 'name' => 'Pump pressure', 'workflow' => $dag, 'definition' => [], 'definition_hash' => str_repeat('c', 64), 'updated_by' => $actor]);
        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        Workflow::create(['organization_id' => $northstar->id, 'name' => 'Pump foreign', 'workflow' => $dag, 'definition' => [], 'definition_hash' => str_repeat('d', 64), 'updated_by' => $actor]);
        $url = $this->base.'/workflows';

        // Callers that do not ask keep geofence workflows only.
        $this->getJson($url)->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.uuid', $geofence->uuid)->assertJsonPath('data.0.kind', 'geofence');
        $this->getJson($url.'?kind=all')->assertOk()->assertJsonPath('meta.total', 2)
            ->assertJsonPath('data.0.uuid', $geofence->uuid)->assertJsonPath('data.0.kind', 'geofence')
            ->assertJsonPath('data.1.uuid', $automation->uuid)->assertJsonPath('data.1.kind', 'automation')->assertJsonPath('data.1.deployment_status', 'inactive');
        $this->getJson($url.'?kind=all&search=Pump')->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.uuid', $automation->uuid);
        $this->getJson($url.'?kind=automation')->assertUnprocessable()->assertJsonValidationErrors('kind');
        $this->getJson($url.'/'.$automation->uuid.'/notifications')->assertOk()->assertJsonPath('data.workflow_kind', 'automation');
        $this->getJson($url.'/'.$geofence->uuid.'/notifications')->assertOk()->assertJsonPath('data.workflow_kind', 'geofence');

        // Members who can view devices list both kinds for the Alerts filter but cannot open the settings.
        $this->actingAs($this->recipient, 'sanctum');
        $this->getJson($url.'?kind=all')->assertOk()->assertJsonPath('meta.total', 2);
        $this->getJson($url.'/'.$automation->uuid.'/notifications')->assertForbidden();
    }

    private function episode(Deployment $deployment, int $episode, array $values = []): Alert
    {
        return Alert::create(['organization_id' => Workflow::findOrFail($deployment->automation_workflow_id)->organization_id, 'automation_workflow_id' => $deployment->automation_workflow_id, 'automation_deployment_id' => $deployment->id, 'episode' => $episode, 'activated_at' => now()->subMinutes(60 - $episode)->startOfSecond(), ...$values]);
    }

    private function deployment(Workflow $workflow, array $definition, int $generation = 1): Deployment
    {
        return Deployment::create(['automation_workflow_id' => $workflow->id, 'generation' => $generation, 'draft_revision' => 1, 'target' => 'active', 'status' => 'succeeded', 'definition' => $definition, 'definition_hash' => str_repeat('d', 64), 'created_by' => $this->workflow->updated_by, 'created_at' => now()]);
    }

    public function test_grouping_by_source_counts_repeats_across_executions_and_honours_filters(): void
    {
        $tractor = $this->deployment->definition['binding']['device_uuid'];
        Device::create(['uuid' => $tractor, 'organization_id' => $this->org->id, 'code' => 'tractor-7', 'name' => 'Tractor 7']);
        $first = $this->episode($this->deployment, 1, ['cleared_at' => now()->subMinutes(50), 'acknowledged_at' => now(), 'acknowledged_by' => $this->workflow->updated_by]);
        $this->episode($this->deployment, 2, ['cleared_at' => now()->subMinutes(40)]);
        // A redeployment of the same workflow and device is the same source.
        $latest = $this->episode($this->deployment($this->workflow, $this->deployment->definition, 2), 3);
        $pump = (string) Str::uuid();
        $dag = Workflow::create(['organization_id' => $this->org->id, 'name' => 'Pump pressure', 'workflow' => ['nodes' => []], 'definition' => [], 'definition_hash' => str_repeat('e', 64), 'updated_by' => $this->workflow->updated_by]);
        $dagDeployment = $this->deployment($dag, ['bindings' => [['role' => 'pump', 'device_uuid' => $pump]]]);
        $this->episode($dagDeployment, 1, ['cleared_at' => now()->subMinutes(30)]);
        $dagLatest = $this->episode($dagDeployment, 2, ['cleared_at' => now()->subMinutes(20)]);
        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $foreign = Workflow::create(['organization_id' => $northstar->id, 'name' => 'Foreign', 'workflow' => ['nodes' => []], 'definition' => [], 'definition_hash' => str_repeat('c', 64), 'updated_by' => $this->workflow->updated_by]);
        $this->episode($this->deployment($foreign, ['binding' => ['device_uuid' => $tractor]]), 9);

        $this->getJson($this->base.'/alerts?group=source')->assertOk()->assertJsonPath('meta.total', 2)->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.workflow_uuid', $dag->uuid)->assertJsonPath('data.0.device_uuid', $pump)->assertJsonPath('data.0.occurrences', 2)
            ->assertJsonPath('data.0.unacknowledged', 2)->assertJsonPath('data.0.active', 0)->assertJsonPath('data.0.latest.uuid', $dagLatest->uuid)
            ->assertJsonPath('data.1.workflow_uuid', $this->workflow->uuid)->assertJsonPath('data.1.device_uuid', $tractor)
            ->assertJsonPath('data.1.occurrences', 3)->assertJsonPath('data.1.unacknowledged', 2)->assertJsonPath('data.1.active', 1)
            ->assertJsonPath('data.1.latest.uuid', $latest->uuid)->assertJsonPath('data.1.latest.device_name', 'Tractor 7')->assertJsonPath('data.1.latest.condition', 'active')
            ->assertJsonPath('data.1.first_activated_at', $first->activated_at->toJSON())->assertJsonPath('data.1.last_activated_at', $latest->activated_at->toJSON());
        $this->getJson($this->base.'/alerts?group=source&condition=cleared&acknowledged=0')->assertJsonPath('meta.total', 2)
            ->assertJsonPath('data.1.occurrences', 1)->assertJsonPath('data.1.unacknowledged', 1)->assertJsonPath('data.1.active', 0);
        $this->getJson($this->base.'/alerts?group=source&condition=active')->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.latest.uuid', $latest->uuid);
        $this->getJson($this->base.'/alerts?group=source&per_page=1&page=2')->assertJsonPath('meta.total', 2)->assertJsonPath('meta.last_page', 2)->assertJsonPath('data.0.workflow_uuid', $this->workflow->uuid);
        // Execution snapshots with a bindings list filter by their first bound device.
        $this->getJson($this->base.'/alerts?group=source&device='.$pump)->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.occurrences', 2);
        $this->getJson($this->base.'/alerts?device='.$pump)->assertJsonPath('meta.total', 2);
        $this->getJson($this->base.'/alerts?device='.$tractor)->assertJsonPath('meta.total', 3);
        $this->getJson($this->base.'/alerts?group=workflow')->assertUnprocessable()->assertJsonValidationErrors('group');
        $this->getJson('/api/v1/organizations/'.$northstar->uuid.'/alerts?group=source')->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.occurrences', 1);
        $this->actingAs($this->recipient, 'sanctum');
        $this->getJson($this->base.'/alerts?group=source')->assertOk()->assertJsonPath('meta.total', 2);
        $this->getJson('/api/v1/organizations/'.$northstar->uuid.'/alerts?group=source')->assertForbidden();
    }

    public function test_bulk_acknowledge_by_list_or_source_is_idempotent_audited_and_tenant_scoped(): void
    {
        $actor = User::where('email', 'super-admin@example.test')->firstOrFail();
        $device = $this->deployment->definition['binding']['device_uuid'];
        [$one, $two, $three] = array_map(fn ($episode) => $this->episode($this->deployment, $episode, ['cleared_at' => now()->subMinutes(10)]), [1, 2, 3]);
        $active = $this->episode($this->deployment, 4);
        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $foreignWorkflow = Workflow::create(['organization_id' => $northstar->id, 'name' => 'Foreign', 'workflow' => ['nodes' => []], 'definition' => [], 'definition_hash' => str_repeat('c', 64), 'updated_by' => $actor->id]);
        $foreign = $this->episode($this->deployment($foreignWorkflow, ['binding' => ['device_uuid' => $device]]), 1, ['cleared_at' => now()]);
        $url = $this->base.'/alerts/acknowledge';

        // Tenant isolation: foreign alerts are never found and never changed.
        $this->postJson($url, ['alert_uuids' => [$one->uuid, $foreign->uuid]])->assertNotFound();
        $this->postJson('/api/v1/organizations/'.$northstar->uuid.'/alerts/acknowledge', ['alert_uuids' => [$one->uuid]])->assertNotFound();
        $this->postJson('/api/v1/organizations/'.$northstar->uuid.'/alerts/acknowledge', ['workflow_uuid' => $this->workflow->uuid, 'device_uuid' => $device])->assertOk()->assertJsonPath('data.acknowledged', 0);
        $this->postJson($url, ['workflow_uuid' => $foreignWorkflow->uuid, 'device_uuid' => $device])->assertOk()->assertJsonPath('data.acknowledged', 0);
        $this->assertNull($one->fresh()->acknowledged_at);
        $this->assertNull($foreign->fresh()->acknowledged_at);

        $this->postJson($url, ['alert_uuids' => [$one->uuid, $two->uuid]])->assertOk()->assertJsonPath('data.acknowledged', 2);
        $acknowledgedAt = $one->fresh()->acknowledged_at;
        $this->assertSame($actor->id, (int) $one->fresh()->acknowledged_by);
        $this->assertDatabaseHas('activity_log', ['event' => 'alert.acknowledged', 'subject_uuid' => $two->uuid, 'causer_id' => $actor->id]);
        $this->assertDatabaseHas('integration_events', ['type' => 'alert.acknowledged.v1', 'resource_uuid' => $one->uuid]);
        $this->getJson($this->base.'/alerts/'.$one->uuid)->assertJsonPath('data.acknowledged_by_name', $actor->name);
        // Idempotent: repeating the request changes nothing and records nothing.
        $this->postJson($url, ['alert_uuids' => [$one->uuid, $two->uuid]])->assertOk()->assertJsonPath('data.acknowledged', 0);
        $this->assertTrue($acknowledgedAt->equalTo($one->fresh()->acknowledged_at));
        $this->assertSame(2, DB::table('activity_log')->where('event', 'alert.acknowledged')->count());

        $this->postJson($url, ['workflow_uuid' => $this->workflow->uuid, 'device_uuid' => $device, 'condition' => 'cleared'])->assertOk()->assertJsonPath('data.acknowledged', 1);
        $this->assertNotNull($three->fresh()->acknowledged_at);
        $this->assertNull($active->fresh()->acknowledged_at);
        $this->postJson($url, ['workflow_uuid' => $this->workflow->uuid, 'device_uuid' => $device, 'condition' => 'cleared'])->assertOk()->assertJsonPath('data.acknowledged', 0);
        $this->postJson($url, ['workflow_uuid' => $this->workflow->uuid, 'device_uuid' => (string) Str::uuid()])->assertOk()->assertJsonPath('data.acknowledged', 0);
        $this->postJson($url, ['workflow_uuid' => $this->workflow->uuid, 'device_uuid' => $device, 'assignee' => $this->recipient->id])->assertOk()->assertJsonPath('data.acknowledged', 0);
        $this->postJson($url, ['workflow_uuid' => $this->workflow->uuid, 'device_uuid' => $device])->assertOk()->assertJsonPath('data.acknowledged', 1);
        $this->assertNotNull($active->fresh()->acknowledged_at);
        $this->assertSame(4, DB::table('integration_events')->where('type', 'alert.acknowledged.v1')->count());
        $this->assertNull($foreign->fresh()->acknowledged_at);

        $this->postJson($url, [])->assertUnprocessable()->assertJsonValidationErrors(['alert_uuids', 'workflow_uuid']);
        $this->postJson($url, ['alert_uuids' => [$one->uuid], 'workflow_uuid' => $this->workflow->uuid, 'device_uuid' => $device])->assertUnprocessable()->assertJsonValidationErrors('alert_uuids');
        $this->postJson($url, ['workflow_uuid' => $this->workflow->uuid])->assertUnprocessable()->assertJsonValidationErrors('device_uuid');
        $this->postJson($url, ['alert_uuids' => array_map(fn () => (string) Str::uuid(), range(1, 501))])->assertUnprocessable()->assertJsonValidationErrors('alert_uuids');
        $this->postJson($url, ['alert_uuids' => [$one->uuid, $one->uuid]])->assertUnprocessable();
        $this->postJson($url, ['workflow_uuid' => $this->workflow->uuid, 'device_uuid' => $device, 'condition' => 'all'])->assertUnprocessable()->assertJsonValidationErrors('condition');

        $this->actingAs($this->recipient, 'sanctum');
        $this->postJson($url, ['alert_uuids' => [$one->uuid]])->assertForbidden();
        $this->postJson($url, ['workflow_uuid' => $this->workflow->uuid, 'device_uuid' => $device])->assertForbidden();
    }
}
