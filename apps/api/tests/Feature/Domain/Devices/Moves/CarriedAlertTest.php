<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices\Moves;

use App\Domain\Automation\Models\Alert;
use App\Domain\Automation\Models\AlertDelivery;
use App\Domain\Automation\Models\Deployment;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Automation\Services\DagActions;

/**
 * A moved alert automation keeps working (spec 031 SC-004): it meets the conditions to
 * keep running, starts in the target once its device is active there, and its next alert
 * is raised in the target, for the target's device, with no editing.
 */
final class CarriedAlertTest extends MoveTestCase
{
    public function test_a_moved_alert_automation_raises_its_next_alert_in_the_target(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $source = $this->automation($this->a, 'Shop low flow', [$x], recipients: [$this->mover->id]);
        $this->automationsOn($this->b);

        $this->moved($this->a, $this->b, [$x]);
        $inB = $this->successor($x);
        $this->applied($inB);
        $moved = Workflow::where('organization_id', $this->b->id)->where('name', 'Shop low flow')->firstOrFail();
        $this->deployed($moved);
        $deployment = Deployment::where('uuid', $moved->fresh()->applied_deployment_uuid)->firstOrFail();

        $intent = ['id' => hash('sha256', 'low-flow-1'), 'operation_uuid' => $deployment->uuid, 'organization_uuid' => $this->b->uuid, 'workflow_uuid' => $moved->uuid,
            'node_id' => 'alert', 'kind' => 'action.alert.v1', 'config' => ['title' => 'Low flow'], 'transition' => 'activated', 'episode' => 1,
            'expires_at' => now()->addMinute()->toJSON(), 'occurred_at' => now()->toJSON()];
        $this->runtimeEvent('automation.intent.v1', $intent)->assertOk();
        app(DagActions::class)->tick($intent['id']);

        $alert = Alert::where('organization_id', $this->b->id)->firstOrFail();
        $this->assertSame($moved->id, $alert->automation_workflow_id);
        $this->assertNotNull($alert->activated_at);
        $this->assertSame([$inB->id], $alert->devices()->pluck('devices.id')->all());
        $this->assertTrue(AlertDelivery::where('automation_alert_id', $alert->id)->where('recipient_id', $this->mover->id)->exists());
        $this->assertSame(0, Alert::where('organization_id', $this->a->id)->where('automation_workflow_id', $source->id)->count());
    }
}
