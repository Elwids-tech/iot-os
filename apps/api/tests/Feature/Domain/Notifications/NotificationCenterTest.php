<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Notifications;

use App\Domain\Notifications\Jobs\DeliverNotificationEmail;
use App\Domain\Notifications\Models\NotificationEvent;
use App\Domain\Notifications\Services\Preferences;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

final class NotificationCenterTest extends TestCase
{
    use RefreshDatabase;

    private User $operator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->operator = User::where('email', 'super-admin@example.test')->firstOrFail();
        config(['notifications.ingest_token' => str_repeat('n', 64), 'notifications.operator_email' => $this->operator->email]);
        Mail::fake();
    }

    private function envelope(string $status = 'firing'): array
    {
        return ['alerts' => [[
            'status' => $status, 'fingerprint' => 'example-fingerprint',
            'startsAt' => '2026-10-05T00:00:00Z', 'endsAt' => '2026-10-05T01:00:00Z',
            'labels' => ['alertname' => 'ApiUnhealthy', 'severity' => 'critical', 'service' => 'api', 'environment' => 'staging', 'secret' => 'must-not-be-stored'],
            'annotations' => ['summary' => 'API readiness failed'],
        ]]];
    }

    private function ingest(string $status = 'firing'): void
    {
        $this->withToken(str_repeat('n', 64))->postJson('/api/internal/notifications/alertmanager', $this->envelope($status))->assertOk();
    }

    public function test_ingestion_requires_a_configured_secret_and_deduplicates_repeats_and_recovery(): void
    {
        $this->postJson('/api/internal/notifications/alertmanager', $this->envelope())->assertUnauthorized();
        $this->ingest();
        $this->ingest();
        $this->assertDatabaseCount('notification_events', 1);
        $event = NotificationEvent::firstOrFail();
        $this->assertSame(2, $event->occurrences);
        $this->assertTrue($event->active);
        $this->assertArrayNotHasKey('secret', $event->labels);
        $this->ingest('resolved');
        $this->assertFalse($event->fresh()->active);
        $this->ingest();
        $this->assertFalse($event->fresh()->active);
        $this->actingAs($this->operator, 'sanctum')->getJson('/api/v1/notifications/events')->assertJsonPath('summary.critical', 0)->assertJsonPath('summary.resolved', 1);
    }

    public function test_recovery_before_firing_does_not_reopen_or_email_an_old_incident(): void
    {
        $this->ingest('resolved');
        $this->ingest();
        $this->assertSame(0, NotificationEvent::where('active', true)->count());
        $this->assertDatabaseCount('notification_email_deliveries', 0);
    }

    public function test_master_opt_out_cancels_an_already_queued_email_without_hiding_events(): void
    {
        $this->actingAs($this->operator, 'sanctum');
        $prefs = $this->getJson('/api/v1/notifications/preferences')->json('data');
        $prefs['grid']['service']['critical'] = true;
        $prefs = $this->putJson('/api/v1/notifications/preferences', $prefs)->assertOk()->json('data');
        $this->ingest();
        $delivery = DB::table('notification_email_deliveries')->first();
        $this->assertNotNull($delivery);
        $prefs['email_enabled'] = false;
        $this->putJson('/api/v1/notifications/preferences', $prefs)->assertOk();
        (new DeliverNotificationEmail($delivery->id))->handle();
        Mail::assertNothingSent();
        $this->assertDatabaseHas('notification_email_deliveries', ['id' => $delivery->id, 'status' => 'cancelled']);
        $this->getJson('/api/v1/notifications/events')->assertJsonPath('meta.total', 1)->assertJsonPath('summary.critical', 1);
        $this->withToken(str_repeat('n', 64))->getJson('/api/internal/notifications/watchdog-preferences')->assertJsonPath('email_enabled', false);
    }

    public function test_preferences_are_personal_revision_checked_and_validate_the_complete_grid(): void
    {
        $this->actingAs($this->operator, 'sanctum');
        $prefs = $this->getJson('/api/v1/notifications/preferences')->json('data');
        $prefs['email_enabled'] = false;
        $this->putJson('/api/v1/notifications/preferences', $prefs)->assertOk()->assertJsonPath('data.revision', 1);
        $this->putJson('/api/v1/notifications/preferences', $prefs)->assertConflict();
        unset($prefs['grid']['workflow']['warning']);
        $this->putJson('/api/v1/notifications/preferences', $prefs)->assertUnprocessable();
        $member = User::where('email', 'acme.member@example.test')->firstOrFail();
        $this->assertTrue(Preferences::view($member)['email_enabled']);
    }

    public function test_members_cannot_view_operations_other_tenants_or_edit_operations_preferences(): void
    {
        $this->ingest();
        $member = User::where('email', 'acme.member@example.test')->firstOrFail();
        $other = Organization::where('slug', '!=', 'acme-manufacturing')->firstOrFail();
        $event = NotificationEvent::firstOrFail()->replicate();
        $event->forceFill(['uuid' => (string) Str::uuid(), 'event_key' => str_repeat('b', 64), 'source' => 'workflow', 'organization_id' => $other->id])->save();
        $this->actingAs($member, 'sanctum')->getJson('/api/v1/notifications/events')->assertJsonPath('meta.total', 0);
        $prefs = $this->getJson('/api/v1/notifications/preferences')->json('data');
        $prefs['grid']['service']['critical'] = true;
        $this->putJson('/api/v1/notifications/preferences', $prefs)->assertForbidden();
    }

    public function test_event_log_counts_active_events_by_type_and_filters_cleared_events_and_one_organization(): void
    {
        $this->ingest();
        $acme = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $base = NotificationEvent::firstOrFail();
        $workflow = fn (Organization $org, string $key, bool $active) => $base->replicate()->forceFill(['uuid' => (string) Str::uuid(), 'event_key' => hash('sha256', $key), 'incident_key' => hash('sha256', $key), 'source' => 'workflow', 'severity' => 'warning', 'status' => 'firing', 'active' => $active, 'organization_id' => $org->id])->save();
        $workflow($acme, 'acme-active', true);
        $workflow($acme, 'acme-cleared', false);
        $workflow($northstar, 'northstar-active', true);
        $this->actingAs($this->operator, 'sanctum');
        $this->getJson('/api/v1/notifications/events')->assertOk()->assertJsonPath('meta.total', 4)
            ->assertJsonPath('summary.sources', ['workflow' => 2, 'service' => 1, 'watchdog' => 0]);
        $this->getJson('/api/v1/notifications/events?status=cleared')->assertJsonPath('meta.total', 1);
        $this->getJson('/api/v1/notifications/events?status=active&organization='.$acme->uuid)->assertJsonPath('meta.total', 2)
            ->assertJsonPath('summary.sources', ['workflow' => 1, 'service' => 1, 'watchdog' => 0]);
        $this->getJson('/api/v1/notifications/events?status=finished')->assertUnprocessable();
        $this->ingest('resolved');
        $this->getJson('/api/v1/notifications/events?status=cleared&source=service')->assertJsonPath('meta.total', 2)->assertJsonPath('summary.sources.service', 0);
        $this->getJson('/api/v1/notifications/events?status=resolved')->assertJsonPath('meta.total', 1);
        $member = User::where('email', 'acme.member@example.test')->firstOrFail();
        // Members never see platform events or other tenants, even when naming them.
        $this->actingAs($member, 'sanctum')->getJson('/api/v1/notifications/events?organization='.$northstar->uuid)->assertJsonPath('meta.total', 0);
        $this->getJson('/api/v1/notifications/events?organization='.$acme->uuid)->assertJsonPath('meta.total', 2)->assertJsonPath('summary.sources.workflow', 1);
    }
}
