<?php

declare(strict_types=1);

namespace App\Domain\Notifications\Http\Controllers;

use App\Domain\Notifications\Services\EventRecorder;
use App\Domain\Notifications\Services\Preferences;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

final class MonitoringIngestController
{
    private function authorize(Request $request): void
    {
        $token = config('notifications.ingest_token');
        abort_unless(is_string($token) && strlen($token) >= 32 && hash_equals($token, $request->bearerToken() ?? ''), 401);
    }

    public function alertmanager(Request $request, EventRecorder $recorder): array
    {
        $this->authorize($request);
        $values = $request->validate([
            'alerts' => 'required|array|max:100', 'alerts.*.status' => ['required', Rule::in(['firing', 'resolved'])],
            'alerts.*.fingerprint' => 'required|string|max:128', 'alerts.*.startsAt' => 'required|date',
            'alerts.*.endsAt' => 'sometimes|date', 'alerts.*.labels' => 'required|array',
            'alerts.*.labels.alertname' => 'required|string|max:255', 'alerts.*.annotations' => 'sometimes|array',
            'alerts.*.annotations.summary' => 'sometimes|string|max:4000',
            'alerts.*.annotations.description' => 'sometimes|string|max:8000',
            'alerts.*.labels.severity' => 'sometimes|string|max:20',
            'alerts.*.labels.service' => 'sometimes|string|max:255',
            'alerts.*.labels.environment' => 'sometimes|string|max:255',
        ]);
        foreach ($values['alerts'] as $alert) {
            $labels = array_intersect_key($alert['labels'], array_flip(['alertname', 'severity', 'service', 'environment']));
            $status = $alert['status'];
            $incident = $alert['fingerprint'].':'.$alert['startsAt'];
            $severity = in_array($labels['severity'] ?? '', ['critical', 'warning', 'info'], true) ? $labels['severity'] : 'warning';
            $recorder->record([
                'source' => 'service', 'event_key' => $incident.':'.$status, 'incident_key' => $incident,
                'severity' => $severity, 'status' => $status, 'title' => $labels['alertname'],
                'summary' => $alert['annotations']['description'] ?? $alert['annotations']['summary'] ?? 'Service monitoring alert.',
                'service' => $labels['service'] ?? null, 'environment' => $labels['environment'] ?? null, 'labels' => $labels,
                'occurred_at' => $status === 'resolved' ? ($alert['endsAt'] ?? now()) : $alert['startsAt'],
            ], email: true);
        }

        return ['accepted' => count($values['alerts'])];
    }

    public function watchdogPreferences(Request $request): array
    {
        $this->authorize($request);
        $operator = Preferences::operator();
        $prefs = $operator ? Preferences::view($operator) : null;

        return ['email_enabled' => (bool) ($prefs['email_enabled'] ?? false), 'grid' => $prefs['grid']['watchdog'] ?? array_fill_keys(Preferences::LEVELS, false)];
    }

    public function watchdog(Request $request, EventRecorder $recorder): array
    {
        $this->authorize($request);
        $values = $request->validate([
            'event_id' => 'required|string|max:128', 'incident_id' => 'required|string|max:128',
            'status' => ['required', Rule::in(['firing', 'resolved'])], 'occurred_at' => 'required|date',
            'summary' => 'required|string|max:8000',
        ]);
        $recorder->record([
            'source' => 'watchdog', 'event_key' => $values['event_id'], 'incident_key' => $values['incident_id'],
            'status' => $values['status'], 'severity' => 'critical', 'title' => 'Application host watchdog',
            'summary' => $values['summary'], 'service' => 'application-host', 'environment' => 'staging',
            'occurred_at' => $values['occurred_at'],
        ]);

        return ['accepted' => true];
    }
}
