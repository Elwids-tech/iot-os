<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Automation;

use App\Domain\Authorization\Enums\OrganizationRoleName;
use App\Domain\Authorization\Models\Role;
use App\Domain\Automation\Jobs\DeliverAlertPush;
use App\Domain\Automation\Models\AlertDelivery;
use App\Domain\Automation\Models\Deployment;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Automation\Services\WorkflowDeploymentService;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Notifications\Jobs\DeliverPushSummary;
use App\Domain\Notifications\Models\PushDevice;
use App\Domain\Notifications\Models\PushSummary;
use App\Domain\Notifications\Services\Preferences;
use App\Domain\Notifications\Services\PushSender;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\PushFixtures;
use Tests\TestCase;

/** Spec 033 US2: who gets a push, what each send checks, and what is recorded. */
final class AlertPushDeliveryTest extends TestCase
{
    use PushFixtures;
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
        [$this->workflow, $this->deployment] = $this->automation($this->org, $actor);
        $this->base = '/api/v1/organizations/'.$this->org->uuid;
        config(['devices.runtime_token' => str_repeat('t', 40)]);
        Mail::fake();
        $this->enablePush();
        $this->fakePushService();
    }

    public function test_a_recipient_with_push_on_gets_one_push_delivery_beside_the_bell(): void
    {
        $this->pushDevice($this->recipient);
        $this->turnOnPush($this->recipient);
        $this->settings();

        $this->transition('activated');
        $this->transition('activated'); // a replay adds nothing

        $push = AlertDelivery::where('channel', AlertDelivery::PUSH)->sole();
        $this->assertSame([$this->recipient->id, 'activated', 'pending'], [$push->recipient_id, $push->type, $push->status]);
        $this->assertSame(1, AlertDelivery::where('channel', AlertDelivery::EMAIL)->count());
        $this->assertSame(1, DB::table('notifications')->count());
        $this->assertSame(1, DB::table('jobs')->where('payload', 'like', '%DeliverAlertPush%')->count());
    }

    public function test_nobody_without_push_on_or_without_a_device_gets_a_push_delivery(): void
    {
        $this->settings();
        $this->transition('activated', 1);
        $this->pushDevice($this->recipient); // a device, but push was never turned on
        $this->transition('activated', 2);
        $this->assertSame(0, AlertDelivery::where('channel', AlertDelivery::PUSH)->count());

        PushDevice::query()->delete();
        $this->turnOnPush($this->recipient); // push on, but no device
        $this->transition('activated', 3);
        $this->assertSame(0, AlertDelivery::where('channel', AlertDelivery::PUSH)->count());

        config(['webpush.vapid.private_key' => null]); // and nothing at all without a push key
        $this->pushDevice($this->recipient);
        $this->transition('activated', 4);
        $this->assertSame(0, AlertDelivery::where('channel', AlertDelivery::PUSH)->count());
    }

    public function test_a_push_reaches_every_device_with_its_headers_and_records_each_one(): void
    {
        $this->pushDevice($this->recipient, 'Safari on iPhone');
        $this->pushDevice($this->recipient, 'Chrome on Android');
        $push = $this->activatedPush();

        $this->deliver($push);

        $push->refresh();
        $this->assertSame(['sent', 2, 2], [$push->status, $push->devices_total, $push->devices_reached]);
        $this->assertNotNull($push->sent_at);
        $history = DB::table('automation_alert_delivery_attempts')->where('automation_alert_delivery_id', $push->id)->orderBy('id')->get();
        $this->assertSame(['Safari on iPhone', 'Chrome on Android'], $history->pluck('device_label')->all());
        $this->assertSame(['accepted', 'accepted'], $history->pluck('status')->all());
        $this->assertSame([201, 201], $history->pluck('response_status')->map(fn ($s) => (int) $s)->all());
        $sent = $this->pushesSent();
        $this->assertCount(2, $sent);
        $this->assertSame(['86400'], $sent[0]['headers']['TTL']);
        $this->assertSame(['high'], $sent[0]['headers']['Urgency']);
        $this->assertSame([str_replace('-', '', (string) $push->alert->uuid)], $sent[0]['headers']['Topic']);
        $this->assertSame(['aes128gcm'], $sent[0]['headers']['Content-Encoding']);
        $this->assertStringStartsWith('vapid t=', $sent[0]['headers']['Authorization'][0]);
    }

    public function test_one_device_accepting_is_enough_and_a_gone_device_is_removed(): void
    {
        $kept = $this->pushDevice($this->recipient, 'Safari on iPhone');
        $gone = $this->pushDevice($this->recipient, 'Old Android');
        $this->fakePushService(fn (ClientRequest $request): int => $request->url() === $gone->endpoint ? 410 : 201);
        $push = $this->activatedPush();

        $this->deliver($push);

        $push->refresh();
        $this->assertSame(['sent', 2, 1], [$push->status, $push->devices_total, $push->devices_reached]);
        $this->assertModelExists($kept);
        $this->assertModelMissing($gone);
        $this->assertNotNull($kept->fresh()->last_reached_at);
    }

    public function test_push_services_that_do_not_answer_are_retried_five_times_then_fail(): void
    {
        $device = $this->pushDevice($this->recipient);
        $this->fakePushService(503);
        $push = $this->activatedPush();

        for ($attempt = 1; $attempt <= 4; $attempt++) {
            try {
                $this->deliver($push);
                $this->fail('A transient failure must be retried.');
            } catch (\RuntimeException) {
                $this->assertSame('pending', $push->fresh()->status);
            }
        }
        $this->deliver($push);

        $push->refresh();
        $this->assertSame(['failed', 5, 0], [$push->status, $push->cycle_attempts, $push->devices_reached]);
        $this->assertSame('Push services did not answer; retry scheduled.', $push->diagnostic);
        $this->assertNotNull($device->fresh()->last_failed_at);
        $this->assertSame(5, DB::table('automation_alert_delivery_attempts')->where('automation_alert_delivery_id', $push->id)->where('status', 'transport_failed')->count());
    }

    public function test_every_device_gone_fails_without_retrying(): void
    {
        $this->pushDevice($this->recipient);
        $this->fakePushService(404);
        $push = $this->activatedPush();

        $this->deliver($push);

        $this->assertSame('failed', $push->fresh()->status);
        $this->assertSame(0, PushDevice::query()->count());
    }

    /** @return array<string, array{string, string}> */
    public static function checks(): array
    {
        return [
            'removed member' => ['Recipient access is no longer valid.', 'removeMembership'],
            'email no longer verified' => ['Recipient access is no longer valid.', 'unverifyEmail'],
            'lost device view' => ['Recipient access is no longer valid.', 'revokeDeviceView'],
            'warning level switched off' => ['Recipient push preferences are off for this level or organization.', 'switchOffWarning'],
            'push turned off everywhere' => ['Recipient push preferences are off for this level or organization.', 'turnOffPushEverywhere'],
            'organization switched off' => ['Recipient push preferences are off for this level or organization.', 'muteOrganization'],
            'no device left at send time' => ['Recipient has no push devices.', 'removeDevices'],
            'subscription disabled' => ['Notification subscription was removed or disabled.', 'disableSubscription'],
            'dropped from the recipients' => ['Notification subscription was removed or disabled.', 'dropRecipient'],
            'execution stopped' => ['Workflow execution has stopped or disable was requested.', 'stopExecution'],
            'execution replaced' => ['Workflow execution was replaced.', 'replaceExecution'],
            // The runtime applying the new execution marks the old one superseded, so this reads as stopped.
            'execution superseded by the runtime' => ['Workflow execution has stopped or disable was requested.', 'supersedeExecution'],
        ];
    }

    #[DataProvider('checks')]
    public function test_each_check_email_makes_cancels_the_push_with_its_reason(string $reason, string $change): void
    {
        $this->pushDevice($this->recipient);
        $push = $this->activatedPush();
        $this->{$change}();

        $this->deliver($push);

        $this->assertSame(['cancelled', $reason], [$push->fresh()->status, $push->fresh()->diagnostic]);
        $this->assertSame([], $this->pushesSent());
    }

    private function removeMembership(): void
    {
        $this->recipient->organizations()->detach($this->org->id);
    }

    private function unverifyEmail(): void
    {
        $this->recipient->forceFill(['email_verified_at' => null])->save();
    }

    private function revokeDeviceView(): void
    {
        Role::where('organization_id', $this->org->id)->where('name', OrganizationRoleName::MEMBER->value)->firstOrFail()
            ->revokePermissionTo(DevicePermission::VIEW->value);
    }

    private function switchOffWarning(): void
    {
        DB::table('notification_preferences')->where('user_id', $this->recipient->id)
            ->update(['push_levels' => json_encode(['critical' => true, 'warning' => false, 'info' => true, 'recovery' => false])]);
    }

    private function turnOffPushEverywhere(): void
    {
        DB::table('notification_preferences')->where('user_id', $this->recipient->id)->update(['push_enabled' => false]);
    }

    private function removeDevices(): void
    {
        PushDevice::query()->where('user_id', $this->recipient->id)->delete();
    }

    private function muteOrganization(): void
    {
        DB::table('push_organization_mutes')->insert(['user_id' => $this->recipient->id, 'organization_id' => $this->org->id, 'created_at' => now()]);
    }

    private function disableSubscription(): void
    {
        $this->workflow->update(['notification_settings' => [...$this->workflow->fresh()->notification_settings, 'enabled' => false]]);
    }

    private function dropRecipient(): void
    {
        $colleague = User::where('email', 'acme.moderator@example.test')->firstOrFail();
        $this->workflow->update(['notification_settings' => [...$this->workflow->fresh()->notification_settings, 'recipient_ids' => [$colleague->id]]]);
    }

    private function stopExecution(): void
    {
        $this->workflow->update(['desired_deployment_uuid' => null]);
    }

    private function replaceExecution(): void
    {
        $next = $this->nextExecution();
        $this->workflow->update(['applied_deployment_uuid' => $next->uuid, 'desired_deployment_uuid' => $next->uuid]);
    }

    private function supersedeExecution(): void
    {
        $next = $this->nextExecution();
        $this->workflow->update(['desired_deployment_uuid' => $next->uuid]);
        $this->workflow->fresh()->deploymentSucceeded($next);
    }

    private function nextExecution(): Deployment
    {
        return Deployment::create(['automation_workflow_id' => $this->workflow->id, 'generation' => 2, 'draft_revision' => 2, 'target' => 'active', 'status' => 'succeeded', 'definition' => $this->deployment->definition, 'definition_hash' => str_repeat('b', 64), 'created_by' => $this->workflow->updated_by, 'created_at' => now()]);
    }

    public function test_a_person_of_another_organization_listed_as_a_recipient_gets_a_cancelled_push(): void
    {
        $outsider = User::where('email', 'northstar.member@example.test')->firstOrFail();
        $outsider->forceFill(['email_verified_at' => now()])->save();
        $theirDevice = $this->pushDevice($outsider);
        $this->turnOnPush($outsider);
        $ourDevice = $this->pushDevice($this->recipient);
        $this->turnOnPush($this->recipient);
        $this->settings();
        // The settings API refuses non-members, so force them in as a stale or tampered row would.
        $this->workflow->update(['notification_settings' => [...$this->workflow->notification_settings, 'recipient_ids' => [$this->recipient->id, $outsider->id]]]);
        $this->transition('activated');
        $theirs = AlertDelivery::where('channel', AlertDelivery::PUSH)->where('recipient_id', $outsider->id)->sole();
        $ours = AlertDelivery::where('channel', AlertDelivery::PUSH)->where('recipient_id', $this->recipient->id)->sole();

        $this->deliver($theirs);
        $this->deliver($ours);

        $this->assertSame(['cancelled', 'Recipient access is no longer valid.'], [$theirs->fresh()->status, $theirs->fresh()->diagnostic]);
        $this->assertSame('sent', $ours->fresh()->status);
        $this->assertSame([$ourDevice->endpoint], array_column($this->pushesSent(), 'url'));
        $this->assertNull($theirDevice->fresh()->last_reached_at);
    }

    public function test_an_activation_that_cleared_first_is_never_pushed(): void
    {
        $this->pushDevice($this->recipient);
        $push = $this->activatedPush();
        $push->alert->update(['cleared_at' => now()]);

        $this->deliver($push);

        $this->assertSame(['cancelled', 'Condition cleared before activation push was sent.'], [$push->fresh()->status, $push->fresh()->diagnostic]);
    }

    public function test_a_clear_is_pushed_only_when_cleared_is_on_and_replaces_the_activation(): void
    {
        $this->pushDevice($this->recipient);
        $this->activatedPush();
        $this->transition('cleared');
        $cleared = AlertDelivery::where('channel', AlertDelivery::PUSH)->where('type', 'cleared')->sole();

        $this->deliver($cleared);
        $this->assertSame('cancelled', $cleared->fresh()->status); // Cleared is off by default

        DB::table('notification_preferences')->where('user_id', $this->recipient->id)
            ->update(['push_levels' => json_encode(['critical' => true, 'warning' => true, 'info' => true, 'recovery' => true])]);
        AlertDelivery::whereKey($cleared->id)->update(['status' => 'pending', 'diagnostic' => null]);
        $this->deliver($cleared);

        $this->assertSame('sent', $cleared->fresh()->status);
        $sent = $this->pushesSent();
        $this->assertSame(['normal'], $sent[0]['headers']['Urgency']);
        $this->assertSame([str_replace('-', '', (string) $cleared->alert->uuid)], $sent[0]['headers']['Topic']);
    }

    public function test_the_deliveries_list_shows_push_rows_and_a_failed_push_can_be_retried(): void
    {
        $this->pushDevice($this->recipient, 'Safari on iPhone');
        $this->fakePushService(404);
        $push = $this->activatedPush();
        $this->deliver($push);

        $rows = $this->getJson($this->base.'/alerts/'.$push->alert->uuid.'/deliveries')->assertOk()->json('data');
        $row = collect($rows)->firstWhere('channel', 'push');
        $this->assertSame(['failed', 1, 0], [$row['status'], $row['devices_total'], $row['devices_reached']]);
        $this->assertSame([['attempt' => 1, 'status' => 'gone', 'device_label' => 'Safari on iPhone', 'response_status' => 404]], collect($row['history'])->map(fn ($h) => collect($h)->except('created_at')->all())->all());
        $this->assertSame('email', collect($rows)->firstWhere('channel', 'email')['channel']);

        $this->pushDevice($this->recipient);
        $this->fakePushService();
        $this->postJson($this->base.'/alerts/'.$push->alert->uuid.'/deliveries/'.$push->uuid.'/retry', ['retry_generation' => 0])->assertStatus(202);
        $this->assertSame(['pending', 1], [$push->fresh()->status, (int) $push->fresh()->retry_generation]);
        (new DeliverAlertPush($push->uuid, 1))->handle(app(DeviceAuthorization::class), app(PushSender::class));
        $this->assertSame('sent', $push->fresh()->status);
    }

    public function test_people_of_another_organization_never_get_a_push(): void
    {
        $outsider = User::where('email', 'northstar.member@example.test')->firstOrFail();
        $outsider->forceFill(['email_verified_at' => now()])->save();
        $this->pushDevice($outsider);
        $this->turnOnPush($outsider);
        $this->pushDevice($this->recipient);
        $push = $this->activatedPush();

        $this->deliver($push);

        $this->assertSame(0, AlertDelivery::where('recipient_id', $outsider->id)->count());
        $this->assertCount(1, $this->pushesSent());
        $this->assertNull(PushDevice::query()->where('user_id', $outsider->id)->value('last_reached_at'));
    }

    public function test_after_three_pushes_in_a_minute_the_rest_join_one_summary(): void
    {
        $this->pushDevice($this->recipient);
        $this->turnOnPush($this->recipient);
        $this->settings();
        foreach (range(1, 5) as $episode) {
            $this->transition('activated', $episode);
        }
        $pushes = AlertDelivery::where('channel', AlertDelivery::PUSH)->orderBy('id')->get();
        $pushes->each(fn (AlertDelivery $push) => $this->deliver($push));

        $this->assertSame(['sent', 'sent', 'sent', 'summarised', 'summarised'], $pushes->map(fn ($p) => $p->fresh()->status)->all());
        $summary = PushSummary::query()->sole();
        $this->assertSame([$summary->id, $summary->id], $pushes->slice(3)->map(fn ($p) => $p->fresh()->push_summary_id)->values()->all());
        $this->assertSame(1, DB::table('jobs')->where('payload', 'like', '%DeliverPushSummary%')->count());

        $this->travel(PushSummary::WINDOW_SECONDS + 1)->seconds();
        $this->deliverSummary($summary);
        $this->deliverSummary($summary); // a duplicate dispatch sends nothing twice

        $summary->refresh();
        $this->assertSame(['sent', 2, 1, 1], [$summary->status, $summary->alert_count, $summary->devices_total, $summary->devices_reached]);
        $sent = $this->pushesSent();
        $this->assertCount(4, $sent);
        $this->assertSame([str_replace('-', '', (string) $this->org->uuid)], $sent[3]['headers']['Topic']);
        $this->assertSame(['normal'], $sent[3]['headers']['Urgency']);
    }

    public function test_a_burst_of_fifty_puts_at_most_four_notifications_on_the_phone(): void
    {
        $this->pushDevice($this->recipient);
        $this->turnOnPush($this->recipient);
        $this->settings();
        foreach (range(1, 50) as $episode) {
            $this->transition('activated', $episode);
        }
        AlertDelivery::where('channel', AlertDelivery::PUSH)->orderBy('id')->get()->each(fn (AlertDelivery $push) => $this->deliver($push));
        $this->travel(PushSummary::WINDOW_SECONDS + 1)->seconds();
        PushSummary::query()->get()->each(fn (PushSummary $summary) => $this->deliverSummary($summary));

        $this->assertSame(1, PushSummary::query()->count());
        $this->assertSame(47, PushSummary::query()->value('alert_count'));
        $this->assertCount(4, $this->pushesSent()); // SC-007
        $this->assertSame(0, AlertDelivery::where('channel', AlertDelivery::PUSH)->whereNotNull('push_summary_id')->where('status', '!=', AlertDelivery::SUMMARISED)->count());
    }

    public function test_activations_after_the_window_send_on_their_own_or_open_a_new_summary(): void
    {
        $this->pushDevice($this->recipient);
        $this->turnOnPush($this->recipient);
        $this->settings();
        foreach (range(1, 4) as $episode) {
            $this->transition('activated', $episode);
        }
        AlertDelivery::where('channel', AlertDelivery::PUSH)->orderBy('id')->get()->each(fn (AlertDelivery $push) => $this->deliver($push));
        $this->travel(PushSummary::WINDOW_SECONDS + 5)->seconds();
        $this->transition('activated', 5);
        $late = AlertDelivery::where('channel', AlertDelivery::PUSH)->orderByDesc('id')->first();

        $this->deliver($late);

        $this->assertSame(['sent', null], [$late->fresh()->status, $late->fresh()->push_summary_id]);
        $this->assertSame(1, PushSummary::query()->count());
    }

    public function test_a_summary_whose_alerts_all_cleared_is_cancelled(): void
    {
        $this->pushDevice($this->recipient);
        $this->turnOnPush($this->recipient);
        $this->settings();
        foreach (range(1, 4) as $episode) {
            $this->transition('activated', $episode);
        }
        AlertDelivery::where('channel', AlertDelivery::PUSH)->orderBy('id')->get()->each(fn (AlertDelivery $push) => $this->deliver($push));
        $summary = PushSummary::query()->sole();
        AlertDelivery::where('push_summary_id', $summary->id)->get()->each(fn (AlertDelivery $push) => $push->alert->update(['cleared_at' => now()]));
        $this->travel(PushSummary::WINDOW_SECONDS + 1)->seconds();

        $this->deliverSummary($summary);

        $this->assertSame(['cancelled', 'Every alert in the summary has cleared.'], [$summary->fresh()->status, $summary->fresh()->diagnostic]);
        $this->assertCount(3, $this->pushesSent());
    }

    public function test_a_second_organizations_alerts_in_the_same_minute_open_their_own_summary(): void
    {
        // A person who is a member of both organizations, with device view in each.
        $this->recipient = User::where('email', 'shared.operator@example.test')->firstOrFail();
        $this->recipient->forceFill(['email_verified_at' => now()])->save();
        $this->pushDevice($this->recipient);
        $this->turnOnPush($this->recipient);
        $this->settings();
        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        [$workflow, $deployment] = $this->automation($northstar, User::where('email', 'super-admin@example.test')->firstOrFail());
        $this->settings($workflow);
        foreach (range(1, 4) as $episode) {
            $this->transition('activated', $episode);
        }
        foreach (range(1, 4) as $episode) {
            $this->transition('activated', $episode, $workflow, $deployment);
        }
        $pushes = AlertDelivery::where('channel', AlertDelivery::PUSH)->orderBy('id')->get();
        $pushes->each(fn (AlertDelivery $push) => $this->deliver($push));

        $statuses = $pushes->map(fn (AlertDelivery $push) => $push->fresh()->status)->all();
        $this->assertSame(['sent', 'sent', 'sent', 'summarised', 'sent', 'sent', 'sent', 'summarised'], $statuses);
        $acme = PushSummary::query()->where('organization_id', $this->org->id)->sole();
        $theirs = PushSummary::query()->where('organization_id', $northstar->id)->sole();
        $this->assertSame([$acme->id, $theirs->id], [$pushes[3]->fresh()->push_summary_id, $pushes[7]->fresh()->push_summary_id]);
        $this->assertSame([$this->recipient->id, $this->recipient->id], [$acme->user_id, $theirs->user_id]);

        $this->travel(PushSummary::WINDOW_SECONDS + 1)->seconds();
        $this->deliverSummary($acme);
        $this->deliverSummary($theirs);

        $this->assertSame([['sent', 1], ['sent', 1]], [[$acme->fresh()->status, $acme->fresh()->alert_count], [$theirs->fresh()->status, $theirs->fresh()->alert_count]]);
        $sent = $this->pushesSent();
        $this->assertCount(8, $sent); // at most four per organization
        $this->assertSame([str_replace('-', '', (string) $northstar->uuid)], $sent[7]['headers']['Topic']);
    }

    public function test_a_duplicate_dispatch_of_a_delivery_sends_once(): void
    {
        $this->pushDevice($this->recipient, 'Safari on iPhone');
        $this->pushDevice($this->recipient, 'Chrome on Android');
        $push = $this->activatedPush();

        $this->deliver($push);
        $this->deliver($push); // the queue ran the same job twice

        $push->refresh();
        $this->assertSame(['sent', 1, 2], [$push->status, (int) $push->attempts, $push->devices_reached]);
        $this->assertCount(2, $this->pushesSent());
        $this->assertSame(2, DB::table('automation_alert_delivery_attempts')->where('automation_alert_delivery_id', $push->id)->count());
    }

    public function test_a_rolled_back_projection_removes_the_push_with_the_bell(): void
    {
        $this->pushDevice($this->recipient);
        $this->turnOnPush($this->recipient);
        $this->settings();
        try {
            DB::transaction(function (): void {
                app(WorkflowDeploymentService::class)->event('workflow.transition.v1', $this->payload('activated', 1, $this->workflow, $this->deployment));
                $this->assertSame(1, AlertDelivery::where('channel', AlertDelivery::PUSH)->count());
                $this->assertSame(1, DB::table('notifications')->count());
                throw new \RuntimeException('Force rollback');
            });
        } catch (\RuntimeException $e) {
            $this->assertSame('Force rollback', $e->getMessage());
        }

        $this->assertSame(0, AlertDelivery::where('channel', AlertDelivery::PUSH)->count());
        $this->assertSame(0, DB::table('notifications')->count());
        $this->assertSame(0, DB::table('jobs')->where('payload', 'like', '%DeliverAlertPush%')->count());
        $this->assertSame([], $this->pushesSent());
    }

    public function test_a_sent_clear_does_not_count_toward_the_three_activations_a_minute(): void
    {
        $this->pushDevice($this->recipient);
        $this->turnOnPush($this->recipient);
        DB::table('notification_preferences')->where('user_id', $this->recipient->id)
            ->update(['push_levels' => json_encode(['critical' => true, 'warning' => true, 'info' => true, 'recovery' => true])]);
        $this->settings();
        // Each is sent before the next arrives, so the first activation is out before it clears.
        foreach ([['activated', 1], ['activated', 2], ['cleared', 1], ['activated', 3]] as [$type, $episode]) {
            $this->transition($type, $episode);
            $this->deliver(AlertDelivery::where('channel', AlertDelivery::PUSH)->orderByDesc('id')->firstOrFail());
        }
        $pushes = AlertDelivery::where('channel', AlertDelivery::PUSH)->orderBy('id')->get();

        $this->assertSame(['activated', 'activated', 'cleared', 'activated'], $pushes->pluck('type')->all());
        $this->assertSame(['sent', 'sent', 'sent', 'sent'], $pushes->map(fn (AlertDelivery $push) => $push->fresh()->status)->all());
        $this->assertSame(0, PushSummary::query()->count());
        $this->assertCount(4, $this->pushesSent());

        // A third activation sent in the minute is what opens a summary.
        $this->transition('activated', 4);
        $fourth = AlertDelivery::where('channel', AlertDelivery::PUSH)->orderByDesc('id')->first();
        $this->deliver($fourth);
        $this->assertSame(AlertDelivery::SUMMARISED, $fourth->fresh()->status);
    }

    private function deliverSummary(PushSummary $summary): void
    {
        (new DeliverPushSummary($summary->uuid))->handle(app(DeviceAuthorization::class), app(PushSender::class));
    }

    private function activatedPush(): AlertDelivery
    {
        $this->turnOnPush($this->recipient);
        $this->settings();
        $this->transition('activated');

        return AlertDelivery::where('channel', AlertDelivery::PUSH)->where('type', 'activated')->sole();
    }

    private function turnOnPush(User $user): void
    {
        Preferences::enablePushDefaults($user);
    }

    private function settings(?Workflow $workflow = null): void
    {
        $workflow ??= $this->workflow;
        if (($workflow->fresh()->notification_settings['enabled'] ?? false) === true) {
            return;
        }
        $org = Organization::findOrFail($workflow->organization_id);
        $this->putJson('/api/v1/organizations/'.$org->uuid.'/workflows/'.$workflow->uuid.'/notifications', ['revision' => 0, 'enabled' => true, 'notify_on_clear' => true, 'recipient_ids' => [$this->recipient->id]])->assertOk();
        $workflow->refresh();
    }

    /**
     * A workflow whose execution is applied, bound to a device the organization does not have.
     *
     * @return array{0: Workflow, 1: Deployment}
     */
    private function automation(Organization $org, User $actor): array
    {
        $definition = ['binding' => ['device_uuid' => (string) Str::uuid()]];
        $workflow = Workflow::create(['organization_id' => $org->id, 'name' => 'Freezer temperature', 'workflow' => ['nodes' => []], 'definition' => $definition, 'definition_hash' => str_repeat('a', 64), 'updated_by' => $actor->id]);
        $deployment = Deployment::create(['automation_workflow_id' => $workflow->id, 'generation' => 1, 'draft_revision' => 1, 'target' => 'active', 'status' => 'succeeded', 'definition' => $definition, 'definition_hash' => str_repeat('a', 64), 'created_by' => $actor->id, 'created_at' => now()]);
        $workflow->update(['applied_deployment_uuid' => $deployment->uuid, 'desired_deployment_uuid' => $deployment->uuid, 'deployment_status' => 'applied']);

        return [$workflow, $deployment];
    }

    private function transition(string $type, int $episode = 1, ?Workflow $workflow = null, ?Deployment $deployment = null): void
    {
        $payload = $this->payload($type, $episode, $workflow ?? $this->workflow, $deployment ?? $this->deployment);
        $this->withToken(str_repeat('t', 40))->postJson('/api/internal/devices/events', ['uuid' => (string) Str::uuid(), 'type' => 'workflow.transition.v1', 'payload' => $payload])->assertOk();
    }

    private function payload(string $type, int $episode, Workflow $workflow, Deployment $deployment): array
    {
        $org = Organization::findOrFail($workflow->organization_id);

        return ['rule_uuid' => $workflow->uuid, 'organization_uuid' => $org->uuid, 'operation_uuid' => $deployment->uuid, 'transition' => ['id' => hash('sha256', $deployment->uuid.':'.$episode.':'.$type), 'type' => $type, 'episode' => $episode, 'occurred_at' => now()->toIso8601String(), 'rule_uuid' => $workflow->uuid, 'organization_uuid' => $org->uuid, 'device_uuid' => $deployment->definition['binding']['device_uuid'], 'version_uuid' => $deployment->uuid, 'definition_hash' => $deployment->definition_hash]];
    }

    private function deliver(AlertDelivery $delivery): void
    {
        (new DeliverAlertPush($delivery->uuid, (int) $delivery->fresh()->retry_generation))->handle(app(DeviceAuthorization::class), app(PushSender::class));
    }
}
