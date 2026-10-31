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
}
