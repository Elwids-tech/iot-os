<?php

declare(strict_types=1);

namespace App\Domain\Automation\Models;

use App\Domain\Devices\Models\DeviceModel;
use App\Domain\Shared\Models\Concerns\Archivable;

final class Workflow extends DeviceModel
{
    use Archivable;

    protected $table = 'automation_workflows';

    protected function casts(): array
    {
        return ['layout' => 'array', 'layout_revision' => 'integer', 'workflow' => 'array', 'definition' => 'array', 'draft_revision' => 'integer', 'deployment_generation' => 'integer', 'notification_settings' => 'array', 'notification_revision' => 'integer'];
    }

    /*
     * Deployment pointers. Three columns say where an automation stands, and they
     * change only here:
     *
     * - desired_deployment_uuid: the deployment that should be running, or null.
     * - applied_deployment_uuid: the one the runtime last confirmed, or null.
     * - pending_operation_uuid: a request the runtime has not answered yet.
     *
     * deployment_status is what people see: pending, applied, suspended, inactive
     * or failed.
     */

    /** A deployment was requested. An activation becomes desired; a deactivation desires nothing. */
    public function deploymentRequested(Deployment $deployment): void
    {
        $this->update([
            'deployment_generation' => $deployment->generation, 'deployment_status' => 'pending',
            'pending_operation_uuid' => $deployment->uuid,
            'desired_deployment_uuid' => $deployment->target === 'active' ? $deployment->uuid : null,
        ]);
    }

    /**
     * The runtime carried out the pending deployment. The deployment that was
     * applied before it stops: superseded by an activation, or with the reason the
     * deactivation gives (a device move), or disabled.
     */
    public function deploymentSucceeded(Deployment $deployment): void
    {
        // A deactivation names why it stopped the automation when a device move did (spec 031).
        $why = $deployment->target === 'inactive' ? $deployment->stopped_reason : null;
        if ($this->applied_deployment_uuid) {
            Deployment::where('uuid', $this->applied_deployment_uuid)->whereNull('stopped_reason')
                ->update(['stopped_reason' => $why ?? ($deployment->target === 'active' ? 'superseded' : 'disabled')]);
        }
        $this->update([
            'pending_operation_uuid' => null,
            'applied_deployment_uuid' => $deployment->target === 'active' ? $deployment->uuid : null,
            'deployment_status' => $deployment->target === 'inactive'
                ? ($why === Deployment::STOPPED_DEVICE_MOVED ? 'suspended' : 'inactive')
                : ($deployment->stopped_reason ? 'suspended' : 'applied'),
        ]);
    }

    /**
     * The runtime refused the pending deployment. It refuses without stopping the
     * execution already running, so that one stays desired and keeps acting.
     */
    public function deploymentRefused(): void
    {
        $applied = $this->applied_deployment_uuid ? Deployment::where('uuid', $this->applied_deployment_uuid)->first() : null;
        $this->update([
            'pending_operation_uuid' => null, 'desired_deployment_uuid' => $applied?->uuid,
            'deployment_status' => $applied ? ($applied->stopped_reason ? 'suspended' : 'applied') : 'failed',
        ]);
    }

    /** The runtime suspended an execution. It shows only when that is the applied one and nothing is pending. */
    public function executionSuspended(Deployment $deployment): void
    {
        if ($this->applied_deployment_uuid === $deployment->uuid && $this->pending_operation_uuid === null) {
            $this->update(['deployment_status' => 'suspended']);
        }
    }

    /**
     * Whether this deployment is the one acting: applied, still desired, and no
     * request waiting on the runtime. An intent from any other deployment is not
     * carried out.
     */
    public function runs(Deployment $deployment): bool
    {
        return ! $this->pending_operation_uuid
            && $this->desired_deployment_uuid === $deployment->uuid
            && $this->applied_deployment_uuid === $deployment->uuid;
    }

    /** DAG automations are schema v2; geofence workflows are v1. */
    public function kind(): string
    {
        return ($this->workflow['schema_version'] ?? '') === 'automation-workflow.v2' ? 'automation' : 'geofence';
    }
}
