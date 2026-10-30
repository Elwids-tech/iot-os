<?php

declare(strict_types=1);

namespace App\Domain\Devices\Http\Controllers;

use App\Domain\Automation\Services\DagActions;
use App\Domain\Automation\Services\WorkflowDeploymentService;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceConfiguration;
use App\Domain\Devices\Models\DeviceOperation;
use App\Domain\Devices\Models\DeviceOutbox;
use App\Domain\Devices\Models\DiscoveryCandidate;
use App\Domain\Devices\Models\SparkplugConnection;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Devices\Services\DeviceConfigurationService;
use App\Domain\Devices\Services\RetentionService;
use App\Domain\Shared\Models\Organization;
use ErrorException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Throwable;
use TypeError;
use ValueError;

final class RuntimeController
{
    /**
     * The runtime reconciles against this snapshot every 30 seconds, so it is
     * built with a fixed number of queries however many devices exist.
     */
    public function state(RetentionService $retention): array
    {
        $organizations = Organization::all();
        $organizationUuids = $organizations->pluck('uuid', 'id');
        $devices = Device::where('lifecycle', '!=', 'archived')
            ->addSelect(['devices.*', 'current_operation_uuid' => DeviceOperation::select('uuid')
                ->whereColumn('device_id', 'devices.id')->whereColumn('generation', 'devices.deployment_generation')->limit(1)])
            ->get();
        $configurations = DeviceConfiguration::whereIn('uuid', $devices->pluck('desired_configuration_uuid')
            ->merge($devices->pluck('applied_configuration_uuid'))->filter()->unique()->values())->get()->keyBy('uuid');
        // A pending adapter-fed activation carries its source's stored birth, as the outbox message does.
        $candidates = DiscoveryCandidate::whereIn('id', $devices->where('deployment_status', 'pending')->pluck('device_discovery_candidate_id')->filter()->unique()->values())
            ->get()->keyBy('id');

        return [
            'connections' => SparkplugConnection::where('status', 'ready')->get()->map(fn ($c) => [
                'uuid' => $c->uuid, 'organization_uuid' => $organizationUuids[$c->organization_id],
                'group_id' => $c->group_id, 'host_id' => $c->host_id, 'username' => $c->username,
                'password' => $c->password, 'broker_url' => config('devices.broker_url'),
            ]),
            'devices' => $devices->map(fn ($d) => [
                'uuid' => $d->uuid, 'organization_uuid' => $organizationUuids[$d->organization_id], 'generation' => $d->deployment_generation, 'operation_uuid' => $d->current_operation_uuid,
                'lifecycle' => $d->lifecycle, 'deployment_status' => $d->deployment_status,
                'desired' => $configurations->get($d->desired_configuration_uuid)?->definition,
                'applied' => $configurations->get($d->applied_configuration_uuid)?->definition,
                ...($d->deployment_status === 'pending' && $d->desired_configuration_uuid
                    ? DeviceConfigurationService::storedBirth($configurations->get($d->desired_configuration_uuid)?->definition ?? [], $candidates->get($d->device_discovery_candidate_id))
                    : []),
            ]),
            'retention' => $organizations->map(fn ($o) => ['organization_uuid' => $o->uuid, ...$retention->effective($o)]),
        ];
    }

    public function claim(): array
    {
        return DB::transaction(function (): array {
            $rows = DeviceOutbox::whereNull('published_at')->where(fn ($q) => $q->whereNull('leased_until')->orWhere('leased_until', '<', now()))
                ->orderBy('id')->limit(100)->lockForUpdate()->get();
            foreach ($rows as $row) {
                $row->update(['lease_token' => (string) Str::uuid(), 'leased_until' => now()->addSeconds(30)]);
            }

            return ['data' => $rows->map(fn ($r) => $r->only(['uuid', 'type', 'payload', 'lease_token']))];
        });
    }

    public function ack(Request $request, DeviceOutbox $event): array
    {
        $values = $request->validate(['lease_token' => ['required', 'uuid']]);
        if ($event->published_at) {
            return ['ok' => true];
        }
        $changed = DeviceOutbox::whereKey($event->id)->where('lease_token', $values['lease_token'])->whereNull('published_at')
            ->update(['published_at' => now(), 'leased_until' => null]);
        abort_unless($changed, 409, 'This outbox lease is no longer current.');

        return ['ok' => true];
    }

    public function automationCommandCheck(Request $request): array
    {
        $v = $request->validate(['action_id' => 'required|string|size:64', 'command_uuid' => 'required|uuid']);

        return ['allowed' => app(DagActions::class)->authorizeDispatch($v['action_id'], $v['command_uuid'])];
    }

    public function event(Request $request): array
    {
        $event = $request->validate(['uuid' => ['required', 'uuid'], 'type' => ['required', Rule::in([
            'connection.presence.v1', 'discovery.presence.v1', 'discovery.birth.v1', 'gateway.presence.v1', 'device.presence.v1', 'device.applied.v1', 'device.failed.v1', 'device.deactivated.v1', 'command.status.v1', 'runtime.heartbeat.v1', 'retention.cleanup.v1', 'workflow.deployment.v1', 'workflow.suspended.v1', 'workflow.transition.v1', 'workflow.membership.v1', 'automation.intent.v1',
        ])], 'payload' => ['required', 'array']]);

        // The runtime retries 5xx and some 4xx forever and dead-letters other 4xx
        // (services/runtime/internal/app/deadletter.go). Deterministic failures must
        // therefore never surface as 500 or 404, or one event blocks every later one.
        try {
            return $this->apply($event);
        } catch (ModelNotFoundException) {
            // A workflow, deployment or organization deleted after the runtime emitted it.
            return $this->unknownReference($event);
        } catch (ErrorException|TypeError|ValueError $exception) {
            return $this->malformed($event, $exception);
        } catch (QueryException $exception) {
            // SQLSTATE classes 22 (data) and 23 (integrity) are properties of the payload;
            // connection and serialization failures stay retryable.
            if (! in_array(substr((string) $exception->getCode(), 0, 2), ['22', '23'], true)) {
                throw $exception;
            }

            return $this->malformed($event, $exception);
        }
    }

    private function apply(array $event): array
    {
        return DB::transaction(function () use ($event): array {
            if (! DB::table('device_inbox')->insertOrIgnore(['uuid' => $event['uuid'], 'type' => $event['type'], 'received_at' => now()])) {
                return ['ok' => true, 'duplicate' => true];
            }
            $p = $event['payload'];
            if ($event['type'] === 'automation.intent.v1') {
                app(DagActions::class)->accept($p);

                return ['ok' => true];
            }
            if (str_starts_with($event['type'], 'workflow.')) {
                app(WorkflowDeploymentService::class)->event($event['type'], $p);

                return ['ok' => true];
            }
            if ($event['type'] === 'runtime.heartbeat.v1') {
                Device::whereNotNull('applied_configuration_uuid')->update(['runtime_seen_at' => now()]);
                SparkplugGateway::query()->update(['runtime_seen_at' => now()]);

                return ['ok' => true];
            }
            if ($event['type'] === 'connection.presence.v1') {
                $connection = SparkplugConnection::where('uuid', $p['connection_uuid'])->first();
                if (! $connection) {
                    return $this->unknownReference($event);
                }
                $connection->gateways()->update(['presence' => $p['presence'], 'runtime_seen_at' => now()]);
                DiscoveryCandidate::whereHas('gateway', fn ($query) => $query->where('sparkplug_connection_id', $connection->id))->update(['presence' => $p['presence']]);

                return ['ok' => true];
            }
            if ($event['type'] === 'discovery.presence.v1') {
                $connection = SparkplugConnection::where('uuid', $p['connection_uuid'])->first();
                if (! $connection) {
                    return $this->unknownReference($event);
                }
                $gateway = $connection->gateways()->where('edge_node_id', $p['edge_node_id'])->first();
                if ($gateway && $gateway->session_id === $p['session_id']) {
                    $gateway->update(['presence' => 'online', 'last_seen_at' => $p['received_at'], 'runtime_seen_at' => now()]);
                    $gateway->candidates()->where('source_device_id', $p['device_id'])->where('session_id', $p['session_id'])->update(['presence' => $p['presence'], 'last_seen_at' => $p['received_at']]);
                }

                return ['ok' => true];
            }
            if ($event['type'] === 'retention.cleanup.v1') {
                $org = Organization::where('uuid', $p['organization_uuid'] ?? '')->first();
                if (! $org) {
                    return $this->unknownReference($event);
                }
                DeviceAudit::record('retention.cleanup', $org->id, null, null, ['status' => $p['status'] ?? 'failed', 'deleted_rows' => (int) ($p['deleted_rows'] ?? 0), 'diagnostic' => mb_substr($p['diagnostic'] ?? '', 0, 2000)]);

                return ['ok' => true];
            }
            if (in_array($event['type'], ['discovery.birth.v1', 'gateway.presence.v1'], true)) {
                $connection = SparkplugConnection::where('uuid', $p['connection_uuid'] ?? '')->first();
                if (! $connection) {
                    return $this->unknownReference($event);
                }
                // Adapter gateways exist only while their adapter does, so a late death from a deleted adapter is stale.
                $gateway = str_starts_with($connection->group_id, 'adapters-')
                    ? SparkplugGateway::where(['sparkplug_connection_id' => $connection->id, 'edge_node_id' => $p['edge_node_id']])->first()
                    : SparkplugGateway::firstOrCreate(['sparkplug_connection_id' => $connection->id, 'edge_node_id' => $p['edge_node_id']],
                        ['organization_id' => $connection->organization_id, 'name' => $p['edge_node_id']]);
                if (! $gateway) {
                    return ['ok' => true, 'stale' => true];
                }
                if ($event['type'] === 'gateway.presence.v1') {
                    if ($gateway->session_id && $gateway->session_id !== ($p['session_id'] ?? null) && ($p['presence'] ?? '') !== 'online') {
                        return ['ok' => true, 'stale' => true];
                    }
                    $gateway->update(['runtime_seen_at' => now(), 'presence' => $p['presence'], 'session_id' => $p['session_id'] ?? null, 'last_seen_at' => $p['last_seen_at'] ?? now()]);
                    if ($p['presence'] !== 'online') {
                        $gateway->candidates()->update(['presence' => $p['presence']]);
                    }
                } else {
                    $gateway->update(['runtime_seen_at' => now(), 'presence' => 'online', 'session_id' => $p['session_id'], 'last_seen_at' => $p['received_at']]);
                    $candidate = DiscoveryCandidate::firstOrCreate(['sparkplug_gateway_id' => $gateway->id, 'source_device_id' => $p['device_id'] ?? ''], ['organization_id' => $connection->organization_id, 'metrics' => []]);
                    $shape = static function (array $metrics): array {
                        $result = [];
                        foreach ($metrics as $metric) {
                            $result[$metric['name']] = $metric['datatype'];
                        }
                        ksort($result);

                        return $result;
                    };
                    $changed = $candidate->birth_revision === 0 || $shape($candidate->metrics) !== $shape($p['metrics']);
                    $candidate->update(['presence' => 'online', 'session_id' => $p['session_id'], 'birth_revision' => $candidate->birth_revision + ($changed ? 1 : 0), 'metrics' => $p['metrics'], 'last_seen_at' => $p['received_at']]);
                }

                return ['ok' => true];
            }
            $device = Device::where('uuid', $p['device_uuid'] ?? '')->whereHas('organization', fn ($q) => $q->where('uuid', $p['organization_uuid'] ?? ''))->lockForUpdate()->first();
            if (! $device) {
                return $this->unknownReference($event);
            }
            if ($event['type'] === 'command.status.v1') {
                $command = $device->commands()->where('uuid', $p['command_uuid'] ?? '')->first();
                if (! $command) {
                    return $this->unknownReference($event);
                }
                if (in_array($command->status, ['observed', 'failed', 'timed_out', 'uncertain', 'already_at_target', 'cancelled'], true)) {
                    return ['ok' => true];
                }
                abort_unless(in_array($p['status'], ['sent', 'observed', 'failed', 'timed_out', 'uncertain', 'cancelled'], true), 422);
                $terminal = $p['status'] !== 'sent';
                $command->update(['status' => $p['status'], 'sent_at' => $p['sent_at'] ?? $command->sent_at, 'diagnostic' => $p['diagnostic'] ?? null,
                    'completed_at' => $terminal ? now() : null, 'outstanding_key' => $terminal ? null : $command->outstanding_key]);
                DeviceAudit::record('command.'.$p['status'], $device->organization_id, $command->created_by, $command->uuid, ['diagnostic' => $p['diagnostic'] ?? null]);
            } elseif ($event['type'] === 'device.presence.v1') {
                if (isset($p['generation']) && $p['generation'] !== $device->deployment_generation) {
                    return ['ok' => true, 'stale' => true];
                }
                if ($device->applied_configuration_uuid !== ($p['configuration_uuid'] ?? null)) {
                    return ['ok' => true, 'stale' => true];
                }
                $device->update(['presence' => $p['presence'], 'last_seen_at' => $p['last_seen_at'] ?? $device->last_seen_at, 'runtime_seen_at' => now(), 'diagnostic' => $p['diagnostic'] ?? null]);
                if ($device->candidate) {
                    $device->candidate->update(['presence' => $p['presence'], 'last_seen_at' => $p['last_seen_at'] ?? $device->candidate->last_seen_at]);
                }
            } else {
                if ($device->deployment_generation !== ($p['generation'] ?? null)) {
                    return ['ok' => true, 'stale' => true];
                }
                $operation = DeviceOperation::where('device_id', $device->id)->where('generation', $device->deployment_generation)->lockForUpdate()->first();
                if (! $operation || $operation->status !== 'pending') {
                    return ['ok' => true, 'stale' => true];
                }
                if (isset($p['operation_uuid']) && $p['operation_uuid'] !== $operation->uuid) {
                    return ['ok' => true, 'stale' => true];
                }
                if (array_key_exists('configuration_uuid', $p) && ($p['configuration_uuid'] ?: null) !== $operation->configuration_uuid) {
                    return ['ok' => true, 'stale' => true];
                }
                if ($event['type'] === 'device.applied.v1' && ($operation->target_state !== 'active' || $operation->configuration_uuid !== ($p['configuration_uuid'] ?? null))) {
                    return ['ok' => true, 'stale' => true];
                }
                if ($event['type'] === 'device.deactivated.v1' && $operation->target_state !== 'inactive') {
                    return ['ok' => true, 'stale' => true];
                }
                if ($event['type'] === 'device.applied.v1') {
                    abort_unless($device->desired_configuration_uuid === ($p['configuration_uuid'] ?? null), 409);
                    $device->update(['applied_configuration_uuid' => $p['configuration_uuid'], 'last_applied_configuration_uuid' => $p['configuration_uuid'], 'applied_generation' => $device->deployment_generation, 'deployment_status' => 'applied', 'lifecycle' => 'active', 'presence' => $p['presence'] ?? 'unknown', 'diagnostic' => null, 'runtime_seen_at' => now()]);
                } elseif ($event['type'] === 'device.deactivated.v1') {
                    abort_unless($device->desired_configuration_uuid === null, 409);
                    $device->update(['applied_configuration_uuid' => null, 'applied_generation' => null, 'deployment_status' => 'inactive', 'lifecycle' => 'deactivated', 'presence' => 'offline', 'diagnostic' => null]);
                    $uncertain = $p['uncertain_command_uuids'] ?? null;
                    $device->commands()->whereNotNull('outstanding_key')->where('status', 'prepared')->update(['status' => 'cancelled', 'outstanding_key' => null, 'completed_at' => now(), 'diagnostic' => 'Unconfirmed command cancelled by deactivation.']);
                    if (is_array($uncertain)) {
                        $device->commands()->whereNotNull('outstanding_key')->whereNotIn('uuid', $uncertain)->where('status', 'pending')->update(['status' => 'cancelled', 'outstanding_key' => null, 'completed_at' => now(), 'diagnostic' => 'Unsent command cancelled by deactivation.']);
                    }
                    $device->commands()->whereNotNull('outstanding_key')->update(['status' => 'uncertain', 'outstanding_key' => null, 'completed_at' => now(), 'diagnostic' => 'Device deactivated while the command was outstanding.']);
                } elseif ($event['type'] === 'device.failed.v1') {
                    // The applied configuration and its generation stay, and so do their bindings (ADR-027).
                    $device->update(['deployment_status' => 'failed', 'diagnostic' => $p['diagnostic'] ?? 'The runtime rejected the configuration.']);
                }
                $operation->update(['status' => $event['type'] === 'device.failed.v1' ? 'failed' : 'succeeded', 'outstanding_key' => null, 'completed_at' => now(), 'diagnostic' => $p['diagnostic'] ?? null]);
                $device->increment('state_revision');
                DeviceAudit::record($event['type'], $device->organization_id, null, $device->uuid, ['generation' => $device->deployment_generation, 'operation_uuid' => $operation->uuid, 'configuration_uuid' => $operation->configuration_uuid]);
            }

            return ['ok' => true];
        });
    }

    /**
     * An event about a connection, device or command that was deleted after the
     * runtime emitted it. It is recorded in the inbox and acknowledged: a 404
     * would make the runtime retry it forever, blocking every later event.
     */
    private function unknownReference(array $event): array
    {
        Log::warning('Runtime event refers to a record that no longer exists.', ['uuid' => $event['uuid'], 'type' => $event['type']]);

        return ['ok' => true, 'ignored' => 'unknown_reference'];
    }

    /**
     * A payload that can never be processed. 422 makes the runtime dead-letter it
     * with its context instead of retrying it forever.
     */
    private function malformed(array $event, Throwable $exception): never
    {
        report($exception);
        Log::error('Runtime event payload is malformed.', ['uuid' => $event['uuid'], 'type' => $event['type'], 'error' => $exception->getMessage()]);

        abort(422, 'The runtime event payload is malformed.');
    }
}
