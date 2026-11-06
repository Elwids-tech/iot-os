<?php

declare(strict_types=1);

namespace App\Domain\Notifications\Services;

use App\Domain\Automation\Models\Alert;
use App\Domain\Notifications\Jobs\DeliverNotificationEmail;
use App\Domain\Notifications\Models\NotificationEvent;
use App\Domain\Shared\Models\Organization;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class EventRecorder
{
    /**
     * Sources of event-log entries. Connectivity alerts (spec 018) are logged before
     * they have an email preference of their own, so these differ from Preferences::SOURCES.
     */
    public const SOURCES = ['workflow', 'service', 'watchdog', 'connectivity'];

    private const KIND_TITLES = [Alert::DEVICE_OFFLINE => 'Device offline', Alert::GATEWAY_OFFLINE => 'Gateway offline', Alert::CONNECTION_LOST => 'Connection lost'];

    private const CAUSES = ['death_certificate' => 'death certificate', 'missed_check_in' => 'missed check-in', 'gateway_offline' => 'gateway offline', 'source_disconnected' => 'connection lost'];

    public function record(array $values, bool $email = false): NotificationEvent
    {
        return DB::transaction(function () use ($values, $email): NotificationEvent {
            $values['event_key'] = hash('sha256', $values['source'].':'.$values['event_key']);
            $values['incident_key'] = hash('sha256', $values['source'].':'.$values['incident_key']);
            if (DB::connection()->getDriverName() === 'pgsql') {
                // Serialize firing/recovery envelopes for the same incident even
                // before a row exists, including Alertmanager retries in parallel.
                DB::select('select pg_advisory_xact_lock(?)', [hexdec(substr($values['incident_key'], 0, 15))]);
            }
            $event = NotificationEvent::firstOrCreate(['event_key' => $values['event_key']], [
                ...$values, 'uuid' => (string) Str::uuid(), 'last_seen_at' => now(), 'active' => $values['status'] === 'firing',
            ]);
            if (! $event->wasRecentlyCreated) {
                $event->update(['last_seen_at' => now(), 'occurrences' => $event->occurrences + 1]);

                return $event;
            }
            if ($event->status === 'resolved') {
                NotificationEvent::where('incident_key', $event->incident_key)->where('status', 'firing')->update(['active' => false]);
            } elseif (NotificationEvent::where('incident_key', $event->incident_key)->where('status', 'resolved')->exists()) {
                // A delayed firing envelope must never reopen a recovered incident.
                $event->update(['active' => false]);
                $email = false;
            }
            $operator = Preferences::operator();
            if ($email && $operator && Preferences::allows($operator, $event->source, $event->status === 'resolved' ? 'recovery' : $event->severity)) {
                $id = DB::table('notification_email_deliveries')->insertGetId([
                    'notification_event_id' => $event->id, 'user_id' => $operator->id,
                    'status' => 'pending', 'created_at' => now(), 'updated_at' => now(),
                ]);
                DeliverNotificationEmail::dispatch($id)->onConnection('alerts')->onQueue('alerts');
            }

            return $event;
        });
    }

    public function workflow(Alert $alert, string $type, string $occurredAt): void
    {
        if (! $alert->isWorkflow()) {
            throw new \LogicException('Only workflow alerts are recorded as workflow events.');
        }
        $alert->loadMissing('workflow');
        $this->record([
            'source' => 'workflow', 'event_key' => $alert->uuid.':'.$type,
            'incident_key' => $alert->uuid, 'organization_id' => $alert->organization_id,
            'severity' => 'warning', 'status' => $type === 'activated' ? 'firing' : 'resolved',
            'title' => $alert->workflow->name,
            'summary' => 'Workflow condition '.($type === 'activated' ? 'activated' : 'cleared').'; episode '.$alert->episode.'.',
            'link' => '/organizations/'.Organization::findOrFail($alert->organization_id)->uuid.'/alerts/'.$alert->uuid,
            'occurred_at' => $occurredAt,
        ]);
    }

    /**
     * A connectivity alert's transition (spec 018): opened is firing, cleared and stopped
     * resolve it. Severity comes from the alert.
     */
    public function connectivity(Alert $alert, string $transition, string $subject, string $occurredAt): void
    {
        if ($alert->isWorkflow()) {
            throw new \LogicException('Workflow alerts are recorded as workflow events.');
        }
        $summary = match ($transition) {
            'opened' => 'Offline: '.(self::CAUSES[$alert->cause] ?? 'unknown cause').($alert->last_seen_at ? '; last seen '.$alert->last_seen_at->utc()->toIso8601ZuluString() : '').'.',
            'cleared' => 'Back online; episode '.$alert->episode.'.',
            default => 'Monitoring stopped ('.str_replace('_', ' ', (string) $alert->stopped_reason).'); episode '.$alert->episode.'.',
        };
        $this->record([
            'source' => 'connectivity', 'event_key' => $alert->uuid.':'.$transition,
            'incident_key' => $alert->uuid, 'organization_id' => $alert->organization_id,
            'severity' => $alert->severity ?? 'warning', 'status' => $transition === 'opened' ? 'firing' : 'resolved',
            'title' => mb_substr((self::KIND_TITLES[$alert->kind] ?? 'Offline').': '.$subject, 0, 255),
            'summary' => $summary,
            'link' => '/organizations/'.Organization::findOrFail($alert->organization_id)->uuid.'/alerts/'.$alert->uuid,
            'occurred_at' => $occurredAt,
        ]);
    }
}
