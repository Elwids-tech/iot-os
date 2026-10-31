<?php

declare(strict_types=1);

namespace App\Domain\Automation\Services;

use App\Domain\Automation\Jobs\DeliverAlertEmail;
use App\Domain\Automation\Models\Alert;
use App\Domain\Automation\Models\AlertDelivery;
use App\Domain\Automation\Models\Deployment;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Automation\Notifications\AlertTransitionNotification;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Integrations\Services\EventJournal;
use App\Domain\Notifications\Services\EventRecorder;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Carbon\CarbonImmutable;

final class AlertProjector
{
    // The caller holds the workflow lock inside the runtime inbox transaction.
    public function project(Workflow $workflow, Deployment $deployment, array $transition): void
    {
        $alert = Alert::firstOrCreate(['automation_deployment_id' => $deployment->id, 'episode' => $transition['episode']], ['organization_id' => $workflow->organization_id, 'automation_workflow_id' => $workflow->id]);
        $device = $this->boundDevice($workflow, $deployment);
        if ($alert->wasRecentlyCreated && $device) {
            $alert->devices()->attach($device->id);
        }
        $alert = Alert::whereKey($alert->id)->lockForUpdate()->firstOrFail();
        $active = $transition['type'] === 'activated';
        $column = $active ? 'activation_transition_id' : 'clear_transition_id';
        if ($alert->$column !== null) {
            return;
        }
        $alert->update([$column => $transition['id'], $active ? 'activated_at' : 'cleared_at' => $transition['occurred_at']]);
        app(EventRecorder::class)->workflow($alert, $transition['type'], $transition['occurred_at']);
        EventJournal::alert($alert, $transition['type']);
        DeviceAudit::record('alert.'.$transition['type'], $workflow->organization_id, null, $alert->uuid, ['transition_id' => $transition['id'], 'episode' => $alert->episode]);
        // A late activation fills history without reopening or notifying an
        // already-cleared episode. Clear-first envelopes never invent activation.
        if (($active && $alert->cleared_at) || (! $active && ! $alert->activated_at)) {
            return;
        }
        $settings = $workflow->notification_settings ?? [];
        if (! ($settings['enabled'] ?? false) || (! $active && ! ($settings['notify_on_clear'] ?? false)) || $deployment->stopped_reason) {
            return;
        }
        $recipients = User::whereIn('id', $settings['recipient_ids'] ?? [])->get()->keyBy('id');
        $bell = $this->bell($workflow, $device, $alert, $transition);
        foreach ($settings['recipient_ids'] ?? [] as $recipient) {
            $delivery = AlertDelivery::firstOrCreate(['automation_alert_id' => $alert->id, 'recipient_id' => $recipient, 'type' => $transition['type'], 'channel' => AlertDelivery::EMAIL]);
            if ($delivery->wasRecentlyCreated) {
                // Explicit database connection uses the SAME database transaction.
                // No after-commit dispatch gap and never the global sync queue.
                DeliverAlertEmail::dispatch($delivery->uuid)->onConnection('alerts')->onQueue('alerts');
                // The bell's copy (spec 022), whatever the person's email preferences;
                // one instance per person, as each carries its own id.
                $recipients->get($recipient)?->notify(new AlertTransitionNotification($bell));
            }
        }
    }

    /**
     * DAG transitions carry no device, so the device comes from the execution's binding,
     * as on the Alerts page. Null when it names no device of the organization.
     */
    private function boundDevice(Workflow $workflow, Deployment $deployment): ?Device
    {
        $bound = $deployment->definition['binding']['device_uuid'] ?? $deployment->definition['bindings'][0]['device_uuid'] ?? null;

        return $bound ? Device::where('organization_id', $workflow->organization_id)->where('uuid', $bound)->first(['id', 'uuid', 'name']) : null;
    }

    /**
     * What the bell shows, with names as they are now.
     *
     * @return array{organization_uuid: string, alert_uuid: string, episode: int, transition: 'activated'|'cleared', occurred_at: string, workflow_uuid: string, workflow_name: string, device_uuid: ?string, device_name: ?string}
     */
    private function bell(Workflow $workflow, ?Device $device, Alert $alert, array $transition): array
    {
        return [
            'organization_uuid' => (string) Organization::whereKey($workflow->organization_id)->value('uuid'),
            'alert_uuid' => (string) $alert->uuid,
            'episode' => (int) $alert->episode,
            'transition' => $transition['type'] === 'activated' ? 'activated' : 'cleared',
            'occurred_at' => CarbonImmutable::parse($transition['occurred_at'])->utc()->toIso8601ZuluString(),
            'workflow_uuid' => (string) $workflow->uuid,
            'workflow_name' => (string) $workflow->name,
            'device_uuid' => $device?->uuid,
            'device_name' => $device?->name,
        ];
    }
}
