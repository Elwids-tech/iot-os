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
use App\Domain\Devices\Services\DeviceAuthorization;
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
}
