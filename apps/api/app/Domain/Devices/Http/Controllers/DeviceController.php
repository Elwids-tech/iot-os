<?php

declare(strict_types=1);

namespace App\Domain\Devices\Http\Controllers;

use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceOperation;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Devices\Services\DeviceConfigurationService;
use App\Domain\Devices\Services\DeviceLifecycleService;
use App\Domain\Devices\Services\DeviceView;
use App\Domain\Devices\Services\RetentionService;
use App\Domain\Devices\Services\RuntimeClient;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

final class DeviceController
{
    public function __construct(private readonly DeviceAuthorization $authorization, private readonly DeviceConfigurationService $configuration) {}

    public function index(Request $request, Organization $organization)
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization);
        $filters = $request->validate(['search' => ['nullable', 'string', 'max:255'], 'lifecycle' => ['nullable', Rule::in(['registered', 'active', 'deactivated', 'archived'])], 'page' => ['integer', 'min:1'], 'per_page' => ['integer', 'min:1', 'max:100']]);
        $result = Device::query()->where('organization_id', $organization->id)->with('candidate.gateway.connection')
            ->when($filters['search'] ?? null, fn ($q, $s) => $q->where(fn ($q) => $q->whereRaw('LOWER(name) LIKE ?', ['%'.mb_strtolower($s).'%'])->orWhereRaw('LOWER(code) LIKE ?', ['%'.mb_strtolower($s).'%'])))
            ->when($filters['lifecycle'] ?? null, fn ($q, $s) => $q->where('lifecycle', $s))->orderBy('name')->paginate($request->integer('per_page', 25));

        return response()->json(['data' => $result->getCollection()->map(fn ($d) => DeviceView::device($d)), 'meta' => ['current_page' => $result->currentPage(), 'last_page' => $result->lastPage(), 'total' => $result->total()]]);
    }

    private function fields(Organization $organization, ?Device $device = null): array
    {
        return ['name' => ['required', 'string', 'max:255'], 'code' => ['required', 'string', 'max:128', 'regex:/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/', Rule::unique('devices')->where('organization_id', $organization->id)->ignore($device?->id)], 'serial_number' => ['nullable', 'string', 'max:255'], 'description' => ['nullable', 'string', 'max:5000']];
    }

    public function store(Request $request, Organization $organization)
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization);
        $values = $request->validate($this->fields($organization));
        $device = DB::transaction(function () use ($values, $organization, $request) {
            $device = Device::create([...$values, 'organization_id' => $organization->id, 'created_by' => $request->user()->id, 'updated_by' => $request->user()->id]);
            DeviceAudit::record('device.registered', $organization->id, $request->user()->id, $device->uuid);

            return $device->refresh();
        });

        return response()->json(['data' => DeviceView::device($device, true)], 201);
    }

    public function show(Request $request, Organization $organization, Device $device)
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization, $device);

        return ['data' => DeviceView::device($device, true)];
    }

    public function update(Request $request, Organization $organization, Device $device)
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization, $device);
        $values = $request->validate([...$this->fields($organization, $device), 'draft_revision' => ['required', 'integer', 'min:1']]);
        $updated = $this->configuration->locked($device, $values['draft_revision'], function ($locked) use ($values, $request) {
            $locked->fill([...$values, 'draft_revision' => $locked->draft_revision + 1, 'updated_by' => $request->user()->id])->save();
            DeviceAudit::record('device.updated', $locked->organization_id, $request->user()->id, $locked->uuid);

            return $locked;
        });

        return ['data' => DeviceView::device($updated, true)];
    }

    public function archive(Request $request, Organization $organization, Device $device)
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization, $device);
        $revision = $this->revision($request);
        $updated = $this->configuration->locked($device, $revision, function ($locked) use ($request) {
            abort_if($locked->applied_configuration_uuid || $locked->desired_configuration_uuid || $locked->deployment_status === 'pending', 422, 'Deactivate the device and wait for runtime acknowledgement before archiving.');
            $locked->forceFill(['lifecycle' => 'archived', 'reserved_source_uuid' => null, 'draft_revision' => $locked->draft_revision + 1])->save();
            DeviceAudit::record('device.archived', $locked->organization_id, $request->user()->id, $locked->uuid);

            return $locked;
        });

        return ['data' => DeviceView::device($updated, true)];
    }

    public function saveConfiguration(Request $request, Organization $organization, Device $device)
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization, $device);
        $values = $request->validate(['draft_revision' => ['required', 'integer', 'min:1'], 'artifact_uuid' => ['required', 'uuid'], 'candidate_uuid' => ['nullable', 'uuid'], 'birth_revision' => ['nullable', 'integer', 'min:0'], 'mappings' => ['present', 'array', 'max:2000'], 'mappings.*.parameter_uuid' => ['required', 'uuid'], 'mappings.*.metric' => ['required', 'string', 'max:255'], 'mappings.*.conversion_mode' => ['sometimes', 'in:profile,custom,none'], 'mappings.*.ingress_conversion' => ['nullable', 'array:source_unit,multiplier,offset'], 'mappings.*.command_metric' => ['nullable', 'string', 'max:255']]);
        $revision = $values['draft_revision'];
        unset($values['draft_revision']);

        return ['data' => DeviceView::device($this->configuration->saveDraft($device, $values, $revision, $request->user()->id), true)];
    }

    public function validateConfiguration(Request $request, Organization $organization, Device $device)
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization, $device);

        return ['data' => $this->configuration->validate($device, $this->revision($request))];
    }

    public function mappingSuggestions(Request $request, Organization $organization, Device $device): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization, $device);
        $values = $request->validate(['artifact_uuid' => ['required', 'uuid']]);
        $artifact = $this->configuration->artifact($device, $values['artifact_uuid']);
        $parameters = collect($artifact->definition['parameters'])->keyBy('uuid');
        $suggestions = [];
        foreach ($artifact->profile->transportBindings()->with('parameterMappings.parameter')->orderBy('id')->limit(100)->get() as $binding) {
            $mappings = [];
            foreach ($binding->parameterMappings as $mapping) {
                $uuid = $mapping->parameter->uuid;
                $parameter = $parameters->get($uuid);
                $metric = $mapping->transport_locator['metric_name'] ?? $mapping->transport_locator['metric'] ?? null;
                if (! $parameter || ! $parameter['reports_state'] || $parameter['kind'] === 'derived' || ! is_string($metric) || $metric === '' || $mapping->transform_config || $mapping->codec_config) {
                    continue;
                }
                $mappings[$uuid] ??= ['parameter_uuid' => $uuid, 'metric' => '', 'command_metric' => null];
                if (in_array($mapping->direction, ['ingress', 'bidirectional'], true)) {
                    $mappings[$uuid]['metric'] = $metric;
                }
                if ($parameter['accepts_command'] && in_array($mapping->direction, ['egress', 'bidirectional'], true)) {
                    $mappings[$uuid]['command_metric'] = $metric;
                }
            }
            $mappings = array_values(array_filter($mappings, fn ($mapping) => $mapping['metric'] !== ''));
            if ($mappings) {
                $suggestions[] = ['binding_uuid' => $binding->uuid, 'name' => $binding->name, 'mappings' => $mappings];
            }
        }

        return ['data' => $suggestions];
    }

    public function lifecycle(Request $request, Organization $organization, Device $device)
    {
        $this->authorization->authorize($request->user(), DevicePermission::ACTIVATE, $organization, $device);
        $input = $request->validate(['operation_uuid' => ['required', 'uuid'], 'target_state' => ['required', Rule::in(['active', 'inactive'])], 'expected_generation' => ['required', 'integer', 'min:0']]);
        $result = app(DeviceLifecycleService::class)->request($device, $input, $request->user()->id);
        $operation = DeviceOperation::where('device_id', $device->id)->where('uuid', $input['operation_uuid'])->firstOrFail();

        return response()->json(['data' => DeviceView::device($result, true), 'operation' => DeviceView::operation($operation)], 202);
    }

    public function operation(Request $request, Organization $organization, Device $device, string $operation)
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization, $device);
        $record = DeviceOperation::where('device_id', $device->id)->where('uuid', $operation)->firstOrFail();

        return ['data' => DeviceView::device($device->fresh(), true), 'operation' => DeviceView::operation($record)];
    }

    public function activate(Request $request, Organization $organization, Device $device)
    {
        $this->authorization->authorize($request->user(), DevicePermission::ACTIVATE, $organization, $device);
        $values = $request->validate(['rollback_configuration_uuid' => ['nullable', 'uuid']]);

        return response()->json(['data' => DeviceView::device($this->configuration->activate($device, $this->revision($request), $request->user()->id, $values['rollback_configuration_uuid'] ?? null), true)], 202);
    }

    public function deactivate(Request $request, Organization $organization, Device $device)
    {
        $this->authorization->authorize($request->user(), DevicePermission::ACTIVATE, $organization, $device);

        return response()->json(['data' => DeviceView::device($this->configuration->deactivate($device, $this->revision($request), $request->user()->id), true)], 202);
    }

    public function latest(Request $request, Organization $organization, Device $device)
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization, $device);

        return app(RuntimeClient::class)->request('GET', '/internal/measurements/latest', ['organization_uuid' => $organization->uuid, 'device_uuid' => $device->uuid, 'configuration_uuid' => $device->applied_configuration_uuid ?? $device->last_applied_configuration_uuid]);
    }

    public function history(Request $request, Organization $organization, Device $device)
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization, $device);
        $values = $request->validate(['from' => ['required', 'date'], 'to' => ['required', 'date', 'after:from'], 'parameter_uuid' => ['required', 'uuid'], 'max_points' => ['sometimes', 'integer', 'min:10', 'max:1000']]);

        return app(RuntimeClient::class)->request('GET', '/internal/measurements/history', [...$values, 'organization_uuid' => $organization->uuid, 'device_uuid' => $device->uuid, 'retention_days' => app(RetentionService::class)->effective($organization)['days']]);
    }

    public function historyRecords(Request $request, Organization $organization, Device $device)
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization, $device);
        $values = $request->validate([
            'from' => ['required', 'date'],
            'to' => ['required', 'date', 'after:from'],
            'parameter_uuid' => ['required', 'uuid'],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:5000'],
            'page_size' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'cursor' => ['sometimes', 'string', 'max:512'],
        ]);
        $values['limit'] ??= 500;
        $values['page_size'] ??= 50;

        return app(RuntimeClient::class)->request('GET', '/internal/measurements/records', [...$values, 'organization_uuid' => $organization->uuid, 'device_uuid' => $device->uuid, 'retention_days' => app(RetentionService::class)->effective($organization)['days']]);
    }

    public function stateHistory(Request $request, Organization $organization, Device $device)
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization, $device);
        $values = $request->validate([
            'from' => ['required', 'date'],
            'to' => ['required', 'date', 'after:from'],
            'parameter_uuid' => ['required', 'uuid'],
            'max_points' => ['sometimes', 'integer', 'min:10', 'max:500'],
        ]);
        $values['max_points'] ??= 500;
        if (! $this->supportsStateHistory($device, $values['parameter_uuid'])) {
            throw ValidationException::withMessages([
                'parameter_uuid' => 'Choose a boolean, enum, or colour-compatible string parameter from a device configuration.',
            ]);
        }

        return app(RuntimeClient::class)->request('GET', '/internal/measurements/state-history', [...$values, 'organization_uuid' => $organization->uuid, 'device_uuid' => $device->uuid, 'retention_days' => app(RetentionService::class)->effective($organization)['days']]);
    }

    private function supportsStateHistory(Device $device, string $parameterUuid): bool
    {
        return $device->configurations()->get()->contains(function ($configuration) use ($parameterUuid): bool {
            $canonical = $configuration->definition['profile_canonical_json'] ?? [];
            $profile = is_string($canonical) ? json_decode($canonical, true) : $canonical;
            $parameter = collect(is_array($profile) ? ($profile['parameters'] ?? []) : [])->firstWhere('uuid', $parameterUuid);
            if (! $parameter) {
                return false;
            }
            if (in_array($parameter['data_type'] ?? null, ['boolean', 'enum'], true)) {
                return true;
            }

            return ($parameter['data_type'] ?? null) === 'string'
                && (($parameter['format'] ?? null) === 'hex_color' || data_get($parameter, 'display.widget') === 'color');
        });
    }

    private function revision(Request $request): int
    {
        return $request->validate(['draft_revision' => ['required', 'integer', 'min:1']])['draft_revision'];
    }
}
