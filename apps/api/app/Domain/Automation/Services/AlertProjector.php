<?php

declare(strict_types=1);

namespace App\Domain\Automation\Services;

use App\Domain\Automation\Jobs\DeliverAlertEmail;
use App\Domain\Automation\Models\Alert;
use App\Domain\Automation\Models\AlertDelivery;
use App\Domain\Automation\Models\Deployment;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Devices\Services\DeviceAudit;

final class AlertProjector
{
    // The caller holds the workflow lock inside the runtime inbox transaction.
    public function project(Workflow $workflow, Deployment $deployment, array $transition): void
    {
        $alert = Alert::firstOrCreate(['automation_deployment_id' => $deployment->id, 'episode' => $transition['episode']], ['organization_id' => $workflow->organization_id, 'automation_workflow_id' => $workflow->id]);
        $active = $transition['type'] === 'activated';
        $column = $active ? 'activation_transition_id' : 'clear_transition_id';
        if ($alert->$column !== null) {
            return;
        }
        $alert->update([$column => $transition['id'], $active ? 'activated_at' : 'cleared_at' => $transition['occurred_at']]);
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
        foreach ($settings['recipient_ids'] ?? [] as $recipient) {
            $delivery = AlertDelivery::firstOrCreate(['automation_alert_id' => $alert->id, 'recipient_id' => $recipient, 'type' => $transition['type']]);
            if ($delivery->wasRecentlyCreated) {
                // Explicit database connection uses the SAME database transaction.
                // No after-commit dispatch gap and never the global sync queue.
                DeliverAlertEmail::dispatch($delivery->uuid)->onConnection('alerts')->onQueue('alerts');
            }
        }
    }
}
