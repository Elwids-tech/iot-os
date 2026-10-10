<?php

declare(strict_types=1);

namespace App\Domain\Devices\Http\Controllers;

use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DiscoveryCandidate;
use App\Domain\Devices\Models\SparkplugConnection;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\BrokerProvisioner;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Devices\Services\DeviceView;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

final class DiscoveryController
{
    public function __construct(private readonly DeviceAuthorization $authorization) {}

    public function connections(Request $request, Organization $organization): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization);

        return $this->directory($request, SparkplugConnection::where('organization_id', $organization->id)->orderBy('name'), fn ($c) => $c->only(['uuid', 'name', 'group_id', 'host_id', 'status', 'diagnostic']), ['name', 'group_id']);
    }

    public function storeConnection(Request $request, Organization $organization)
    {
        $this->authorization->authorize($request->user(), DevicePermission::CONNECTIONS, $organization);
        $values = $request->validate(['name' => ['required', 'string', 'max:255'], 'group_id' => ['required', 'string', 'max:128', 'regex:/^[a-zA-Z0-9_.:-]+$/', 'unique:sparkplug_connections,group_id']]);
        $uuid = (string) Str::uuid();
        $connection = SparkplugConnection::create([...$values, 'uuid' => $uuid, 'organization_id' => $organization->id,
            'host_id' => 'iot-host-'.$uuid, 'username' => 'host-'.$uuid, 'password' => Str::random(48)]);

        return $this->provisionConnection($request, $organization, $connection);
    }

    public function provisionConnection(Request $request, Organization $organization, SparkplugConnection $connection)
    {
        $this->authorization->authorize($request->user(), DevicePermission::CONNECTIONS, $organization, $connection);
        try {
            app(BrokerProvisioner::class)->connection($connection);
        } catch (\Throwable $exception) {
            $connection->update(['status' => 'failed', 'diagnostic' => 'Provisioning failed. Verify broker connectivity and management credentials, then retry.']);
            report($exception);
        }
        DeviceAudit::record('connection.provisioned', $organization->id, $request->user()->id, $connection->uuid, ['status' => $connection->status]);

        return response()->json(['data' => $connection->only(['uuid', 'name', 'group_id', 'host_id', 'status', 'diagnostic'])], $connection->status === 'ready' ? 200 : 202);
    }

    public function gateways(Request $request, Organization $organization): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization);

        return $this->directory($request, SparkplugGateway::where('organization_id', $organization->id)->with('connection')->withCount('candidates')->orderBy('name'), fn ($g) => DeviceView::gateway($g), ['name', 'edge_node_id']);
    }

    public function storeGateway(Request $request, Organization $organization)
    {
        $this->authorization->authorize($request->user(), DevicePermission::CONNECTIONS, $organization);
        $values = $request->validate(['connection_uuid' => ['required', 'uuid'], 'name' => ['required', 'string', 'max:255'], 'edge_node_id' => ['required', 'string', 'max:128', 'regex:/^[a-zA-Z0-9_.:-]+$/']]);
        $connection = SparkplugConnection::where('organization_id', $organization->id)->where('uuid', $values['connection_uuid'])->firstOrFail();
        abort_unless($connection->status === 'ready', 422, 'Provision the connection first.');
        abort_if($connection->gateways()->where('edge_node_id', $values['edge_node_id'])->exists(), 422, 'This Edge Node is already registered.');
        $uuid = (string) Str::uuid();
        $gateway = $connection->gateways()->create(['uuid' => $uuid, 'organization_id' => $organization->id, 'name' => $values['name'], 'edge_node_id' => $values['edge_node_id'], 'username' => 'edge-'.$uuid, 'password' => Str::random(48)]);
        app(BrokerProvisioner::class)->gateway($gateway);
        DeviceAudit::record('gateway.registered', $organization->id, $request->user()->id, $gateway->uuid);

        return response()->json(['data' => DeviceView::gateway($gateway->refresh())], 201);
    }

    public function candidates(Request $request, Organization $organization): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization);

        return $this->directory($request, DiscoveryCandidate::where('organization_id', $organization->id)->with(['gateway' => fn ($q) => $q->withCount('candidates'), 'gateway.connection', 'assignedDevice'])->orderBy('id'), fn ($c) => DeviceView::candidate($c), ['source_device_id'], true);
    }

    public function provisionGateway(Request $request, Organization $organization, SparkplugGateway $gateway): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::CONNECTIONS, $organization, $gateway);
        abort_unless($gateway->username && $gateway->password, 422, 'This source has no platform-managed gateway credentials.');
        app(BrokerProvisioner::class)->gateway($gateway);
        DeviceAudit::record('gateway.provisioned', $organization->id, $request->user()->id, $gateway->uuid);

        return ['data' => DeviceView::gateway($gateway)];
    }

    public function candidate(Request $request, Organization $organization, DiscoveryCandidate $candidate): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization, $candidate);

        return ['data' => DeviceView::candidate($candidate)];
    }

    private function directory(Request $request, $query, callable $view, array $columns, bool $candidates = false): array
    {
        $filters = $request->validate(['search' => ['nullable', 'string', 'max:255'], 'page' => ['sometimes', 'integer', 'min:1'], 'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'], 'gateway_uuid' => ['nullable', 'uuid'],
            'status' => ['nullable', Rule::in(['pending', 'approved', 'rejected'])], 'unassigned' => ['sometimes', Rule::in(['0', '1', 'true', 'false'])]]);
        if (! empty($filters['search'])) {
            $needle = '%'.mb_strtolower($filters['search']).'%';
            $query->where(function ($query) use ($columns, $needle, $candidates): void {
                foreach ($columns as $column) {
                    $query->orWhereRaw('LOWER('.$column.') LIKE ?', [$needle]);
                }
                if ($candidates) {
                    $query->orWhereHas('gateway', fn ($q) => $q->whereRaw('LOWER(name) LIKE ?', [$needle])->orWhereRaw('LOWER(edge_node_id) LIKE ?', [$needle]));
                }
            });
        }
        if ($candidates && ! empty($filters['gateway_uuid'])) {
            $query->whereHas('gateway', fn ($q) => $q->where('uuid', $filters['gateway_uuid']));
        }
        if ($candidates && $request->boolean('available')) {
            // Pending sources no device has reserved or claimed through a guided setup.
            $query->where('status', 'pending')->whereDoesntHave('assignedDevice')->whereNotExists(fn ($q) => $q->selectRaw('1')->from('device_onboardings')
                ->join('devices', 'devices.id', '=', 'device_onboardings.device_id')->where('devices.lifecycle', '!=', 'archived')
                ->whereColumn('device_onboardings.sparkplug_gateway_id', 'device_discovery_candidates.sparkplug_gateway_id')
                ->whereColumn('device_onboardings.source_device_id', 'device_discovery_candidates.source_device_id'));
        }
        if ($candidates && ! empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        // Sources no device has reserved yet: what the Devices page asks operators to review.
        if ($candidates && $request->boolean('unassigned')) {
            $query->whereDoesntHave('assignedDevice');
        }
        $page = $query->paginate($request->integer('per_page', 100));

        return ['data' => $page->getCollection()->map($view), 'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()]];
    }

    public function review(Request $request, Organization $organization, DiscoveryCandidate $candidate): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization, $candidate);
        $values = $request->validate(['status' => ['required', Rule::in(['pending', 'approved', 'rejected'])], 'birth_revision' => ['required', 'integer', 'min:0']]);
        DB::transaction(function () use ($candidate, $values, $request, $organization) {
            $locked = DiscoveryCandidate::whereKey($candidate->id)->lockForUpdate()->firstOrFail();
            abort_unless($locked->birth_revision === $values['birth_revision'], 409, 'The discovery candidate changed.');
            abort_if(Device::where('reserved_source_uuid', $locked->uuid)->exists(), 422, 'This source is assigned to a device.');
            abort_if($values['status'] === 'rejected' && $locked->setupDevice(), 422, 'This source is being set up as a device. Resume or archive that device first.');
            $locked->update(['status' => $values['status']]);
            DeviceAudit::record('discovery.'.$values['status'], $organization->id, $request->user()->id, $locked->uuid);
        });

        return ['data' => DeviceView::candidate($candidate->fresh())];
    }
}
