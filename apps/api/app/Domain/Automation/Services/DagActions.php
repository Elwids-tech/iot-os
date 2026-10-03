<?php

declare(strict_types=1);

namespace App\Domain\Automation\Services;

use App\Domain\Automation\Models\Deployment;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceCommand;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Devices\Services\DeviceCommandService;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

final class DagActions
{
    // Called within the durable runtime inbox transaction. No side effects here.
    public function accept(array $intent): void
    {
        validator($intent, ['id' => 'required|string|size:64', 'operation_uuid' => 'required|uuid', 'organization_uuid' => 'required|uuid', 'workflow_uuid' => 'required|uuid', 'node_id' => 'required|string|max:64', 'kind' => 'required|in:action.command.v1,action.alert.v1,action.event.v1', 'expires_at' => 'required|date', 'occurred_at' => 'required|date', 'config' => 'required|array'])->validate();
        $org = Organization::where('uuid', $intent['organization_uuid'])->firstOrFail();
        $w = Workflow::where('organization_id', $org->id)->where('uuid', $intent['workflow_uuid'])->firstOrFail();
        $d = Deployment::where('automation_workflow_id', $w->id)->where('uuid', $intent['operation_uuid'])->firstOrFail();
        $node = collect($d->definition['nodes'] ?? [])->firstWhere('id', $intent['node_id']);
        abort_unless($node && $node['type'] === $intent['kind'] && $node['config'] == $intent['config'], 422, 'Intent does not match immutable deployment.');
        DB::table('automation_actions')->insertOrIgnore(['id' => $intent['id'], 'organization_id' => $org->id, 'automation_deployment_id' => $d->id, 'node_id' => $intent['node_id'], 'kind' => $intent['kind'], 'intent' => json_encode($intent, JSON_THROW_ON_ERROR), 'expires_at' => Carbon::parse($intent['expires_at']), 'created_at' => now(), 'updated_at' => now()]);
    }

    public function tick(string $id): void
    {
        $record = DB::table('automation_actions')->where('id', $id)->first();
        if (! $record) {
            return;
        }
        DB::transaction(function () use ($id, $record) {
            $d = Deployment::findOrFail($record->automation_deployment_id);
            $w = Workflow::whereKey($d->automation_workflow_id)->lockForUpdate()->firstOrFail();
            $settings = DB::table('automation_settings')->where('organization_id', $w->organization_id)->lockForUpdate()->first();
            $action = DB::table('automation_actions')->where('id', $id)->lockForUpdate()->first();
            if (! $action) {
                return;
            }
            $finish = function (string $status, ?string $message = null, array $extra = []) use ($id) {
                DB::table('automation_actions')->where('id', $id)->update(['status' => $status, 'diagnostic' => $message, 'updated_at' => now(), ...$extra]);
            };
            if ($action->command_uuid) {
                $command = DeviceCommand::where('uuid', $action->command_uuid)->firstOrFail();
                $device = $command->device;
                app(DeviceCommandService::class)->expire($device);
                $command->refresh();
                $status = match ($command->status) {
                    'pending','prepared' => $action->dispatch_authorized_at ? 'dispatched' : 'accepted','sent','dispatching' => 'dispatched','confirmed','already_at_target','observed' => 'observed_at_target','uncertain','timed_out' => 'uncertain',default => 'failed'
                };
                if ($status === 'uncertain') {
                    DB::table('automation_command_targets')->where('device_id', $device->id)->where('parameter_uuid', $command->parameter_uuid)->update(['uncertain_command_uuid' => $command->uuid]);
                }$finish($status, $command->diagnostic);

                return;
            }
            if ($action->status !== 'accepted') {
                return;
            }
            if (! $settings?->enabled || $settings->stopped || $w->applied_deployment_uuid !== $d->uuid || $w->desired_deployment_uuid !== $d->uuid || $w->pending_operation_uuid || $d->stopped_reason) {
                $finish('cancelled', 'Automation stopped or execution replaced.');

                return;
            }
            if (Carbon::parse($action->expires_at)->isPast()) {
                $finish('expired', 'Action deadline passed.');

                return;
            }
            $intent = json_decode($action->intent, true, 512, JSON_THROW_ON_ERROR);
            $org = Organization::findOrFail($w->organization_id);
            $actor = User::find($d->created_by);
            try {
                abort_unless($actor, 403, 'Approving user is unavailable.');
                app(DagAuthorization::class)->authorize($actor, $org, 'activate');
                if ($action->kind === 'action.alert.v1') {
                    app(AlertProjector::class)->project($w, $d, ['id' => $id, 'type' => $intent['transition'], 'episode' => $intent['episode'], 'occurred_at' => $intent['occurred_at']]);
                    $finish('succeeded');

                    return;
                }
                if ($action->kind === 'action.event.v1') {
                    $this->journal($org, $d, $intent);
                    $finish('succeeded');

                    return;
                }
                $grant = collect($d->command_grants ?? [])->firstWhere('node_id', $action->node_id);
                abort_unless($grant && Carbon::parse($grant['expires_at'])->isFuture(), 403, 'Command authorization expired.');
                $binding = collect($d->definition['bindings'])->firstWhere('role', $grant['binding']);
                $device = Device::where('organization_id', $org->id)->where('uuid', $binding['device_uuid'])->lockForUpdate()->firstOrFail();
                app(DeviceAuthorization::class)->authorize($actor, DevicePermission::COMMAND, $org, $device);
                abort_unless($device->applied_configuration_uuid === $binding['configuration_uuid'] && $device->deployment_generation === $binding['generation'], 409, 'Target configuration changed.');
                DB::table('automation_command_targets')->insertOrIgnore(['device_id' => $device->id, 'parameter_uuid' => $binding['parameter_uuid']]);
                $targetQuery = DB::table('automation_command_targets')->where('device_id', $device->id)->where('parameter_uuid', $binding['parameter_uuid']);
                $target = (clone $targetQuery)->lockForUpdate()->first();
                // Include uncertain manual commands: they may also have reached this actuator.
                abort_if($target->uncertain_command_uuid || $device->commands()->where('parameter_uuid', $binding['parameter_uuid'])->whereIn('status', ['uncertain', 'timed_out'])->whereNotIn('uuid', DB::table('automation_command_reconciliations')->select('command_uuid'))->exists(), 409, 'Reconcile uncertain command delivery before further automation.');
                if ($target->last_sent_at && Carbon::parse($target->last_sent_at)->addSeconds($grant['cooldown_seconds'])->isFuture()) {
                    $finish('suppressed', 'Target cooldown.');

                    return;
                }
                $sameMinute = $target->minute_start && Carbon::parse($target->minute_start)->addMinute()->isFuture();
                $count = $sameMinute ? $target->minute_count : 0;
                if ($count >= $grant['max_per_minute']) {
                    $finish('suppressed', 'Target rate limit.');

                    return;
                }
                $command = app(DeviceCommandService::class)->sendAutomation($device, ['configuration_uuid' => $binding['configuration_uuid'], 'parameter_uuid' => $binding['parameter_uuid'], 'value' => $grant['value'], 'idempotency_key' => $this->commandKey($id)], $actor->id, Carbon::parse($action->expires_at), $id);
                $targetQuery->update(['last_sent_at' => now(), 'minute_start' => $sameMinute ? $target->minute_start : now(), 'minute_count' => $count + 1]);
                $finish($command->status === 'already_at_target' ? 'observed_at_target' : 'accepted', null, ['command_uuid' => $command->uuid]);
                DeviceAudit::record('automation.command_requested', $org->id, $actor->id, $command->uuid, ['action_id' => $id, 'deployment_uuid' => $d->uuid]);
            } catch (ValidationException $e) {
                $finish('failed', $e->getMessage());
            } catch (HttpExceptionInterface $e) {
                if ($e->getStatusCode() >= 500) {
                    throw $e;
                }$finish('failed', $e->getMessage());
            }
        }, 3);
    }

    /** The runtime calls this immediately before a first physical send. */
    public function authorizeDispatch(string $id, string $commandUuid): bool
    {
        $record = DB::table('automation_actions')->where('id', $id)->first();
        if (! $record) {
            return false;
        }

        return DB::transaction(function () use ($id, $commandUuid, $record) {
            $d = Deployment::findOrFail($record->automation_deployment_id);
            $w = Workflow::whereKey($d->automation_workflow_id)->lockForUpdate()->firstOrFail();
            $settings = DB::table('automation_settings')->where('organization_id', $w->organization_id)->lockForUpdate()->first();
            $action = DB::table('automation_actions')->where('id', $id)->lockForUpdate()->first();
            if (! $settings?->enabled || $settings->stopped || ! $action || $action->command_uuid !== $commandUuid || ! in_array($action->status, ['accepted', 'dispatched'], true) || Carbon::parse($action->expires_at)->isPast() || $w->pending_operation_uuid || $w->desired_deployment_uuid !== $d->uuid || $w->applied_deployment_uuid !== $d->uuid || $d->stopped_reason) {
                return false;
            }
            $grant = collect($d->command_grants ?? [])->firstWhere('node_id', $action->node_id);
            if (! $grant || Carbon::parse($grant['expires_at'])->isPast()) {
                return false;
            }
            $actor = User::find($d->created_by);
            if (! $actor) {
                return false;
            }$org = Organization::findOrFail($w->organization_id);
            $binding = collect($d->definition['bindings'])->firstWhere('role', $grant['binding']);
            $device = Device::where('organization_id', $org->id)->where('uuid', $binding['device_uuid'])->first();
            if (! $device || $device->lifecycle !== 'active' || $device->applied_configuration_uuid !== $binding['configuration_uuid'] || $device->deployment_generation !== $binding['generation']) {
                return false;
            }
            try {
                app(DagAuthorization::class)->authorize($actor, $org, 'activate');
                app(DeviceAuthorization::class)->authorize($actor, DevicePermission::COMMAND, $org, $device);
            } catch (HttpExceptionInterface) {
                return false;
            }
            DB::table('automation_actions')->where('id', $id)->update(['status' => 'dispatched', 'dispatch_authorized_at' => $action->dispatch_authorized_at ?? now(), 'updated_at' => now()]);

            return true;
        }, 3);
    }

    private function commandKey(string $id): string
    {
        return substr($id, 0, 8).'-'.substr($id, 8, 4).'-4'.substr($id, 13, 3).'-a'.substr($id, 17, 3).'-'.substr($id, 20, 12);
    }

    private function journal(Organization $org, Deployment $d, array $intent): void
    {
        DB::table('integration_streams')->insertOrIgnore(['organization_id' => $org->id, 'sequence' => 0]);
        $stream = DB::table('integration_streams')->where('organization_id', $org->id)->lockForUpdate()->first();
        DB::table('integration_events')->insert(['uuid' => (string) Str::uuid(), 'organization_id' => $org->id, 'sequence' => $stream->sequence + 1, 'device_uuid' => $d->definition['bindings'][0]['device_uuid'], 'resource_uuid' => $this->commandKey($intent['id']), 'type' => 'automation.triggered.v1', 'snapshot' => json_encode(['workflow_uuid' => $intent['workflow_uuid'], 'action_id' => $intent['id'], 'name' => $intent['config']['name'], 'node_id' => $intent['node_id']],JSON_THROW_ON_ERROR), 'occurred_at' => Carbon::parse($intent['occurred_at']), 'recorded_at' => now()]);
        DB::table('integration_streams')->where('organization_id',$org->id)->update(['sequence' => $stream->sequence + 1]);
    }
}
