<?php

declare(strict_types=1);

namespace App\Domain\Devices\Http\Controllers;

use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Devices\Services\RuntimeClient;
use App\Domain\Devices\Services\TelemetryDiagnosis;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

final class TelemetryCaptureController
{
    public function __construct(private readonly DeviceAuthorization $authorization, private readonly RuntimeClient $runtime) {}

    private function authorize(Request $request, Organization $organization): void
    {
        // Raw gateway captures may include unassigned source values: require management access.
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization);
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization);
    }

    public function index(Request $request, Organization $organization): array
    {
        $this->authorize($request, $organization);

        return $this->runtime->request('GET', '/internal/telemetry/captures', ['organization_uuid' => $organization->uuid]);
    }

    public function store(Request $request, Organization $organization)
    {
        $this->authorize($request, $organization);
        $input = $request->validate(['gateway_uuid' => ['required', 'uuid'], 'device_uuid' => ['nullable', 'uuid'], 'duration_seconds' => ['required', 'integer', 'min:60', 'max:600']]);
        $gateway = SparkplugGateway::where('organization_id', $organization->id)->where('uuid', $input['gateway_uuid'])->firstOrFail();
        $source = null;
        if ($input['device_uuid'] ?? null) {
            $device = Device::where('organization_id', $organization->id)->where('uuid', $input['device_uuid'])->firstOrFail();
            abort_unless($device->candidate?->sparkplug_gateway_id === $gateway->id, 422, 'The device is not assigned to this gateway.');
            $source = $device->candidate->source_device_id;
        }
        $result = $this->runtime->request('POST', '/internal/telemetry/captures', [
            'organization_uuid' => $organization->uuid, 'connection_uuid' => $gateway->connection->uuid,
            'gateway_uuid' => $gateway->uuid, 'edge_node_id' => $gateway->edge_node_id,
            'source_device_id' => $source, 'device_uuid' => $input['device_uuid'] ?? '',
            'user_id' => $request->user()->id, 'duration_seconds' => $input['duration_seconds'],
        ]);
        DeviceAudit::record('telemetry.capture.started', $organization->id, $request->user()->id, $result['data']['id'], ['gateway_uuid' => $gateway->uuid, 'device_uuid' => $input['device_uuid'] ?? null, 'duration_seconds' => $input['duration_seconds']]);

        return response()->json($result, 201);
    }

    public function show(Request $request, Organization $organization, string $capture): array
    {
        $this->authorize($request, $organization);

        return $this->runtime->request('GET', '/internal/telemetry/captures/'.rawurlencode($capture), ['organization_uuid' => $organization->uuid]);
    }

    public function update(Request $request, Organization $organization, string $capture): array
    {
        $this->authorize($request, $organization);
        $input = $request->validate(['action' => ['required', Rule::in(['stop', 'delete', 'suspend', 'resume'])], 'confirm' => ['accepted_if:action,suspend']]);
        $session = $this->show($request, $organization, $capture)['data'];
        if (in_array($input['action'], ['suspend', 'resume']) || ($session['suspended'] ?? false)) {
            $this->authorization->authorize($request->user(), DevicePermission::ACTIVATE, $organization);
        }
        $result = $this->runtime->request('POST', '/internal/telemetry/captures/'.rawurlencode($capture), ['organization_uuid' => $organization->uuid, 'action' => $input['action']]);
        DeviceAudit::record('telemetry.capture.'.$input['action'], $organization->id, $request->user()->id, $capture, ['device_uuid' => $session['scope']['device_uuid'] ?? null]);

        return $result;
    }

    public function diagnose(Request $request, Organization $organization, string $capture): array
    {
        $input = $request->validate(['question' => ['required', 'string', 'max:2000'], 'sample_ids' => ['required', 'array', 'min:1', 'max:5'], 'sample_ids.*' => ['required', 'uuid']]);
        $session = $this->show($request, $organization, $capture)['data'];
        $samples = collect($session['samples'])->whereIn('id', $input['sample_ids'])->values();
        abort_unless($samples->count() === count(array_unique($input['sample_ids'])), 422, 'A selected sample has left the capture buffer. Select a current sample.');
        // Raw wire payloads are deliberately excluded from model context.
        $evidence = $samples->map(function ($sample) {
            unset($sample['wire_base64']);

            return $sample;
        })->all();
        $result = app(TelemetryDiagnosis::class)->answer($input['question'], $evidence);
        DeviceAudit::record('telemetry.capture.diagnosed', $organization->id, $request->user()->id, $capture, ['sample_ids' => $input['sample_ids']]);

        return ['data' => $result];
    }
}
