<?php

declare(strict_types=1);

namespace App\Domain\Devices\Http\Controllers;

use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceOnboarding;
use App\Domain\Devices\Models\DiscoveryCandidate;
use App\Domain\Devices\Models\SparkplugConnection;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\BrokerProvisioner;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Devices\Services\DeviceConnectionKit;
use App\Domain\Devices\Services\DeviceView;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

final class OnboardingController
{
    public function __construct(private readonly DeviceAuthorization $authorization) {}

    public function store(Request $request, Organization $organization)
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization);
        $v = $request->validate([
            'request_uuid' => ['required', 'uuid'], 'name' => ['required', 'string', 'max:255'],
            'artifact_uuid' => ['required', 'uuid'], 'mode' => ['required', Rule::in(['direct', 'gateway'])],
            'gateway_uuid' => ['required_if:mode,gateway', 'nullable', 'uuid'],
            'source_device_id' => ['required_if:mode,gateway', 'nullable', 'string', 'max:128', 'regex:/^[a-zA-Z0-9_.:-]+$/'],
        ]);
        if ($v['mode'] === 'direct') {
            $this->authorization->authorize($request->user(), DevicePermission::CONNECTIONS, $organization);
        }
        $hash = hash('sha256', json_encode([$v['name'], $v['artifact_uuid'], $v['mode'], $v['gateway_uuid'] ?? null, $v['source_device_id'] ?? null]));
        $setup = DB::transaction(function () use ($v, $organization, $request, $hash) {
            // Serialize setup allocation per tenant. A lost response can be retried without new devices or passwords.
            Organization::whereKey($organization->id)->lockForUpdate()->firstOrFail();
            $existing = DeviceOnboarding::where('uuid', $v['request_uuid'])->first();
            if ($existing) {
                abort_unless($existing->organization_id === $organization->id, 404);
                abort_unless(hash_equals($existing->request_hash, $hash), 409, 'This setup request was already used. Resume that device or start a new setup.');

                return $existing;
            }
            $artifact = DeviceProfileArtifact::where('uuid', $v['artifact_uuid'])->whereHas('profile', fn ($q) => $q->where('organization_id', $organization->id))->firstOrFail();
            if ($v['mode'] === 'direct') {
                $connection = SparkplugConnection::firstOrCreate(['group_id' => 'onboarding-'.$organization->uuid], [
                    'organization_id' => $organization->id, 'name' => 'Direct device connections',
                    'host_id' => 'iot-onboarding-'.$organization->uuid, 'username' => 'host-'.Str::uuid(), 'password' => Str::random(48),
                ]);
                abort_unless($connection->organization_id === $organization->id, 409);
                $gateway = SparkplugGateway::create([
                    'organization_id' => $organization->id, 'sparkplug_connection_id' => $connection->id,
                    'name' => $v['name'], 'edge_node_id' => 'device-'.$v['request_uuid'],
                    'username' => 'edge-'.Str::uuid(), 'password' => Str::random(48),
                ]);
                $source = '';
            } else {
                $gateway = SparkplugGateway::where('organization_id', $organization->id)->where('uuid', $v['gateway_uuid'])->firstOrFail();
                abort_unless($gateway->connection->status === 'ready', 422, 'The selected gateway connection must be provisioned first.');
                $source = $v['source_device_id'];
                abort_if(DeviceOnboarding::where('sparkplug_gateway_id', $gateway->id)->where('source_device_id', $source)->exists(), 409, 'This gateway device already has a setup. Resume its existing device.');
                $candidate = DiscoveryCandidate::where('sparkplug_gateway_id', $gateway->id)->where('source_device_id', $source)->first();
                abort_if($candidate && Device::where('reserved_source_uuid', $candidate->uuid)->exists(), 409, 'This source is already assigned to another device.');
            }
            $device = Device::create([
                'organization_id' => $organization->id, 'name' => $v['name'],
                'code' => 'device-'.$v['request_uuid'], 'created_by' => $request->user()->id, 'updated_by' => $request->user()->id,
                'draft' => ['artifact_uuid' => $artifact->uuid, 'candidate_uuid' => null, 'birth_revision' => null, 'mappings' => []],
            ]);
            $setup = DeviceOnboarding::create([
                'uuid' => $v['request_uuid'], 'organization_id' => $organization->id, 'device_id' => $device->id,
                'sparkplug_gateway_id' => $gateway->id, 'device_profile_artifact_id' => $artifact->id,
                'mode' => $v['mode'], 'source_device_id' => $source, 'request_hash' => $hash,
                'provisioned_at' => $v['mode'] === 'gateway' ? now() : null,
            ]);
            DeviceAudit::record('device.onboarding.started', $organization->id, $request->user()->id, $device->uuid, ['mode' => $v['mode']]);

            return $setup;
        });

        return response()->json(['data' => $this->view($setup)], 201);
    }

    public function show(Request $request, Organization $organization, Device $device): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization, $device);
        $setup = DeviceOnboarding::where('device_id', $device->id)->first();

        return ['data' => $setup ? $this->view($setup) : null];
    }

    public function provision(Request $request, Organization $organization, Device $device)
    {
        $this->authorization->authorize($request->user(), DevicePermission::CONNECTIONS, $organization, $device);
        abort_if($device->lifecycle === 'archived', 422, 'Archived devices are read-only.');
        $setup = DeviceOnboarding::where('device_id', $device->id)->firstOrFail();
        abort_unless($setup->mode === 'direct', 422, 'The existing gateway is managed separately.');
        DB::transaction(function () use ($setup, $organization, $request): void {
            $locked = DeviceOnboarding::whereKey($setup->id)->lockForUpdate()->firstOrFail();
            if ($locked->provisioned_at) {
                return;
            }
            try {
                $connection = SparkplugConnection::whereKey($locked->gateway->sparkplug_connection_id)->lockForUpdate()->firstOrFail();
                $provisioner = app(BrokerProvisioner::class);
                if ($connection->status !== 'ready') {
                    $provisioner->connection($connection);
                }
                $provisioner->gateway($locked->gateway);
                $locked->update(['provisioned_at' => now(), 'diagnostic' => null]);
                DeviceAudit::record('device.onboarding.provisioned', $organization->id, $request->user()->id, $locked->device->uuid);
            } catch (\Throwable $exception) {
                $locked->update(['diagnostic' => 'Connection setup could not reach the broker. Retry, or ask an administrator to check broker provisioning.']);
                // Do not report HTTP exceptions whose request bodies can contain MQTT credentials.
            }
        });
        $setup->refresh();

        return response()->json(['data' => $this->view($setup)], $setup->provisioned_at ? 200 : 202);
    }

    public function kit(Request $request, Organization $organization, Device $device)
    {
        $this->authorization->authorize($request->user(), DevicePermission::CONNECTIONS, $organization, $device);
        $setup = DeviceOnboarding::where('device_id', $device->id)->firstOrFail();
        $kit = app(DeviceConnectionKit::class)->make($setup);
        DeviceAudit::record('device.connection-kit.downloaded', $organization->id, $request->user()->id, $device->uuid);

        return response()->json(['data' => $kit])->withHeaders(['Cache-Control' => 'no-store, private', 'Pragma' => 'no-cache', 'X-Content-Type-Options' => 'nosniff']);
    }

    public function archive(Request $request, Organization $organization, Device $device)
    {
        $this->authorization->authorize($request->user(), DevicePermission::CONNECTIONS, $organization, $device);
        $setup = DeviceOnboarding::where('device_id', $device->id)->firstOrFail();
        $kit = app(DeviceConnectionKit::class)->make($setup);
        DeviceAudit::record('device.connection-kit.downloaded', $organization->id, $request->user()->id, $device->uuid);

        return response(base64_decode($kit['archive_base64']), 200, [
            'Content-Type' => 'application/zip', 'Content-Disposition' => 'attachment; filename="'.$kit['filename'].'"',
            'Cache-Control' => 'no-store, private', 'Pragma' => 'no-cache', 'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    private function view(DeviceOnboarding $setup): array
    {
        $candidate = DiscoveryCandidate::where('sparkplug_gateway_id', $setup->sparkplug_gateway_id)->where('source_device_id', $setup->source_device_id)->first();
        $artifact = $setup->artifact;

        return [
            'uuid' => $setup->uuid, 'mode' => $setup->mode, 'source_device_id' => $setup->source_device_id,
            'provisioned' => (bool) $setup->provisioned_at, 'diagnostic' => $setup->diagnostic,
            'device' => DeviceView::device($setup->device, true), 'gateway' => DeviceView::gateway($setup->gateway),
            'candidate' => $candidate ? DeviceView::candidate($candidate) : null,
            'artifact' => [...$artifact->only(['uuid', 'revision', 'definition', 'definition_hash', 'status', 'compiled_at']), 'profile_uuid' => $artifact->profile->uuid],
            'broker_url' => config('devices.broker_public_url'),
        ];
    }
}
