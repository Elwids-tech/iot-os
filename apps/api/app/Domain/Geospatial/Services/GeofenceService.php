<?php

declare(strict_types=1);

namespace App\Domain\Geospatial\Services;

use App\Domain\Automation\Models\Deployment;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Automation\Services\WorkflowDeploymentService;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Devices\Services\RuntimeClient;
use App\Domain\Geospatial\Models\Geofence;
use App\Domain\Geospatial\Models\GeofenceActivationBatch;
use App\Domain\Geospatial\Models\GeofenceAssignment;
use App\Domain\Geospatial\Models\LocationBinding;
use App\Domain\Shared\Models\Organization;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

final class GeofenceService
{
    public function __construct(private readonly RuntimeClient $runtime) {}

    public function saveAndActivate(Organization $organization, ?Geofence $fence, array $input, ?int $actor, ?string $application = null): array
    {
        $requestHash = $this->requestHash($fence, $input);
        if ($existing = $this->existingBatch($organization, $fence, $input['operation_uuid'], $requestHash, $actor, $application)) {
            $existingFence = Geofence::where('organization_id', $organization->id)->findOrFail($existing->geofence_id);

            return ['data' => $this->view($existingFence), 'activation' => $this->batch($existing)];
        }

        $compiled = [];
        foreach ($input['assignments'] as $assignment) {
            $binding = LocationBinding::where('organization_id', $organization->id)
                ->whereHas('device', fn ($query) => $query->where('uuid', $assignment['device_uuid']))->firstOrFail();
            $workflow = $fence ? $this->assignmentFor($fence, $binding)?->workflow : null;
            $workflowUuid = $workflow?->uuid ?? (string) Str::uuid();
            $graph = $this->graph($workflowUuid, $this->binding($organization, $binding), $input['geometry'], $assignment['policy']);
            $result = $this->runtime->request('POST', '/internal/workflows/compile', ['workflow' => $graph]);
            abort_unless(($result['valid'] ?? false) && isset($result['definition'], $result['definition_hash']), 422, 'The runtime rejected this geofence.');
            $compiled[] = compact('binding', 'workflow', 'graph', 'result', 'assignment');
        }

        [$fence, $batch, $created] = DB::transaction(function () use ($organization, $fence, $input, $actor, $application, $compiled, $requestHash): array {
            Organization::whereKey($organization->id)->lockForUpdate()->firstOrFail();
            if ($existing = $this->existingBatch($organization, $fence, $input['operation_uuid'], $requestHash, $actor, $application)) {
                return [Geofence::findOrFail($existing->geofence_id), $existing, false];
            }
            if ($fence) {
                $fence = Geofence::whereKey($fence->id)->lockForUpdate()->firstOrFail();
                abort_unless($fence->organization_id === $organization->id, 404);
                abort_unless($fence->revision === $input['expected_revision'], 409, 'The geofence changed. Reload before saving.');
                $fence->update(['name' => $input['name'], 'geometry' => $input['geometry'], 'revision' => $fence->revision + 1, 'updated_by' => $actor ?? $fence->updated_by]);
            } else {
                abort_unless($input['expected_revision'] === 0, 409, 'A new geofence must start at revision zero.');
                $fence = Geofence::create(['organization_id' => $organization->id, 'name' => $input['name'], 'geometry' => $input['geometry'],
                    'revision' => 1, 'created_by' => $actor, 'updated_by' => $actor]);
            }

            $selected = collect($compiled)->pluck('binding.id');
            $removed = GeofenceAssignment::where('geofence_id', $fence->id)->whereNotIn('device_location_binding_id', $selected)->get();
            $batch = GeofenceActivationBatch::create(['uuid' => $input['operation_uuid'], 'organization_id' => $organization->id,
                'geofence_id' => $fence->id, 'geofence_revision' => $fence->revision, 'status' => 'pending',
                'request_hash' => $requestHash, 'created_by' => $actor, 'application_uuid' => $application]);

            foreach ($compiled as $item) {
                $workflow = $item['workflow'];
                if ($workflow) {
                    $workflow->update(['name' => $fence->name.' — '.$item['binding']->device->name, 'workflow' => $item['graph'],
                        'definition' => $item['result']['definition'], 'definition_hash' => $item['result']['definition_hash'],
                        'draft_revision' => $workflow->draft_revision + 1, 'updated_by' => $actor ?? $workflow->updated_by]);
                } else {
                    $workflow = Workflow::create(['uuid' => $item['graph']['uuid'], 'organization_id' => $organization->id,
                        'name' => $fence->name.' — '.$item['binding']->device->name, 'draft_revision' => 1,
                        'workflow' => $item['graph'], 'definition' => $item['result']['definition'],
                        'definition_hash' => $item['result']['definition_hash'], 'updated_by' => $actor]);
                }
                DB::table('automation_workflow_revisions')->insert(['automation_workflow_id' => $workflow->id,
                    'revision' => $workflow->draft_revision, 'snapshot' => json_encode(['uuid' => $workflow->uuid, 'name' => $workflow->name,
                        'draft_revision' => $workflow->draft_revision, 'workflow' => $workflow->workflow,
                        'definition_hash' => $workflow->definition_hash], JSON_THROW_ON_ERROR), 'created_by' => $actor, 'created_at' => now()]);
                $assignment = GeofenceAssignment::updateOrCreate(
                    ['geofence_id' => $fence->id, 'device_location_binding_id' => $item['binding']->id],
                    ['organization_id' => $organization->id, 'automation_workflow_id' => $workflow->id,
                        'policy' => $item['assignment']['policy'], 'desired_geofence_revision' => $fence->revision,
                        'status' => 'pending', 'diagnostic' => null],
                );
                DB::table('geofence_activation_items')->insert(['geofence_activation_batch_id' => $batch->id,
                    'geofence_assignment_id' => $assignment->id, 'assignment_uuid' => $assignment->uuid,
                    'device_uuid' => $item['binding']->device->uuid, 'operation_uuid' => (string) Str::uuid(),
                    'target' => 'active', 'status' => 'pending', 'created_at' => now(), 'updated_at' => now()]);
            }
            foreach ($removed as $assignment) {
                $assignment->update(['status' => 'removing', 'desired_geofence_revision' => $fence->revision]);
                DB::table('geofence_activation_items')->insert(['geofence_activation_batch_id' => $batch->id,
                    'geofence_assignment_id' => $assignment->id, 'assignment_uuid' => $assignment->uuid,
                    'device_uuid' => $assignment->device_location_binding_id
                        ? LocationBinding::findOrFail($assignment->device_location_binding_id)->device->uuid
                        : throw new \LogicException('A geofence assignment must have a location binding.'),
                    'operation_uuid' => (string) Str::uuid(),
                    'target' => 'inactive', 'status' => 'pending', 'created_at' => now(), 'updated_at' => now()]);
            }
            DeviceAudit::record('geofence.saved_and_activated', $organization->id, $actor, $fence->uuid,
                ['revision' => $fence->revision, 'operation_uuid' => $batch->uuid, 'application_uuid' => $application]);

            return [$fence, $batch, true];
        });

        if ($created) {
            $this->dispatch($batch);
        }

        return ['data' => $this->view($fence->fresh()), 'activation' => $this->batch($batch->fresh())];
    }

    public function dispatch(GeofenceActivationBatch $batch, ?int $onlyItem = null): void
    {
        $items = DB::table('geofence_activation_items')->where('geofence_activation_batch_id', $batch->id)
            ->when($onlyItem, fn ($query) => $query->where('id', $onlyItem))->get();
        foreach ($items as $item) {
            $assignment = GeofenceAssignment::findOrFail($item->geofence_assignment_id);
            $workflow = Workflow::findOrFail($assignment->automation_workflow_id);
            try {
                app(WorkflowDeploymentService::class)->request($workflow, ['operation_uuid' => $item->operation_uuid,
                    'target_state' => $item->target, 'draft_revision' => $workflow->draft_revision,
                    'expected_generation' => $workflow->deployment_generation], $batch->created_by ?? $workflow->updated_by);
            } catch (HttpExceptionInterface $error) {
                DB::table('geofence_activation_items')->where('id', $item->id)->update(['status' => 'failed',
                    'diagnostic' => $error->getMessage(), 'updated_at' => now()]);
                $assignment->update(['status' => 'failed', 'diagnostic' => $error->getMessage()]);
            }
        }
    }

    public function retry(GeofenceActivationBatch $batch, int $itemId): array
    {
        $item = DB::table('geofence_activation_items')->where('geofence_activation_batch_id', $batch->id)->where('id', $itemId)->firstOrFail();
        abort_unless($item->status === 'failed', 409, 'Only a failed activation can be retried.');
        DB::table('geofence_activation_items')->where('id', $item->id)->update(['operation_uuid' => (string) Str::uuid(),
            'status' => 'pending', 'diagnostic' => null, 'updated_at' => now()]);
        $this->dispatch($batch, $item->id);

        return $this->batch($batch->fresh());
    }

    public function view(Geofence $fence): array
    {
        return [...$fence->only(['uuid', 'name', 'geometry', 'revision', 'created_at', 'updated_at']),
            'assignments' => GeofenceAssignment::where('geofence_id', $fence->id)->get()->map(function ($assignment): array {
                $binding = LocationBinding::findOrFail($assignment->device_location_binding_id);
                $device = Device::findOrFail($binding->device_id);
                $workflow = Workflow::findOrFail($assignment->automation_workflow_id);

                return [...$assignment->only(['uuid', 'policy', 'desired_geofence_revision', 'applied_geofence_revision', 'status', 'diagnostic']),
                    'device' => $device->only(['uuid', 'name', 'code']), 'workflow_uuid' => $workflow->uuid,
                    'deployment_status' => $workflow->deployment_status];
            })->values()];
    }

    public function batch(GeofenceActivationBatch $batch): array
    {
        $items = DB::table('geofence_activation_items')->where('geofence_activation_batch_id', $batch->id)->orderBy('id')->get()->map(function ($item): array {
            $assignment = GeofenceAssignment::find($item->geofence_assignment_id);
            $deployment = Deployment::where('uuid', $item->operation_uuid)->first();
            $status = $deployment?->status ?? $item->status;
            $diagnostic = $deployment?->diagnostic ?? $item->diagnostic;
            if ($item->status !== $status || $item->diagnostic !== $diagnostic) {
                DB::table('geofence_activation_items')->where('id', $item->id)->update([
                    'status' => $status, 'diagnostic' => $diagnostic, 'updated_at' => now(),
                ]);
            }
            if ($status === 'succeeded') {
                if ($item->target === 'inactive') {
                    $assignment?->delete();
                } elseif ($assignment) {
                    $assignment->update(['status' => 'active', 'applied_geofence_revision' => $assignment->desired_geofence_revision, 'diagnostic' => null]);
                }
            } elseif ($status === 'failed' && $assignment) {
                $assignment->update(['status' => 'failed', 'diagnostic' => $diagnostic]);
            }

            return ['id' => $item->id, 'assignment_uuid' => $item->assignment_uuid, 'device_uuid' => $item->device_uuid,
                'operation_uuid' => $item->operation_uuid, 'target' => $item->target, 'status' => $status, 'diagnostic' => $diagnostic];
        });
        $statuses = $items->pluck('status');
        $status = $statuses->contains('pending') ? 'pending' : ($statuses->contains('failed') ? 'partial_failure' : 'succeeded');
        if ($batch->status !== $status) {
            $batch->update(['status' => $status]);
        }

        return [...$batch->only(['uuid', 'geofence_revision', 'status', 'created_at', 'updated_at']), 'items' => $items];
    }

    private function assignmentFor(Geofence $fence, LocationBinding $binding): ?GeofenceAssignment
    {
        return GeofenceAssignment::where('geofence_id', $fence->id)->where('device_location_binding_id', $binding->id)->first();
    }

    private function binding(Organization $organization, LocationBinding $binding): array
    {
        return ['schema_version' => 'location-binding.v1', ...$binding->only(['uuid', 'revision', 'configuration_uuid', 'generation',
            'latitude_parameter_uuid', 'longitude_parameter_uuid', 'accuracy_parameter_uuid', 'max_age_seconds',
            'max_future_skew_seconds', 'allow_unknown_accuracy']), 'organization_uuid' => $organization->uuid,
            'device_uuid' => $binding->device->uuid, 'pairing' => 'same_event'];
    }

    private function graph(string $uuid, array $binding, array $geometry, array $policy): array
    {
        return ['schema_version' => 'automation-workflow.v1', 'uuid' => $uuid, 'version_uuid' => (string) Str::uuid(),
            'nodes' => [
                ['id' => '0', 'type' => 'location.source.v1', 'config' => ['binding' => $binding]],
                ['id' => '1', 'type' => 'geofence.membership.v1', 'config' => ['geometry' => $geometry, 'uncertainty_metres' => $policy['uncertainty_metres']]],
                ['id' => '2', 'type' => 'condition.sustained.v1', 'config' => ['outside_for_seconds' => $policy['outside_for_seconds'],
                    'max_gap_seconds' => $policy['max_gap_seconds'], 'minimum_samples' => $policy['minimum_samples']]],
                ['id' => '3', 'type' => 'alert.condition.v1', 'config' => (object) []],
            ], 'edges' => [['source' => '0', 'target' => '1'], ['source' => '1', 'target' => '2'], ['source' => '2', 'target' => '3']]];
    }

    private function requestHash(?Geofence $fence, array $input): string
    {
        $assignments = collect($input['assignments'])->sortBy('device_uuid')->values()->all();

        return hash('sha256', json_encode([
            'geofence_uuid' => $fence?->uuid,
            'expected_revision' => $input['expected_revision'],
            'name' => $input['name'],
            'geometry' => $input['geometry'],
            'assignments' => $assignments,
        ], JSON_THROW_ON_ERROR));
    }

    private function existingBatch(Organization $organization, ?Geofence $fence, string $operationUuid, string $requestHash, ?int $actor, ?string $application): ?GeofenceActivationBatch
    {
        $existing = GeofenceActivationBatch::where('uuid', $operationUuid)->first();
        if (! $existing) {
            return null;
        }
        abort_unless(
            $existing->organization_id === $organization->id
            && $existing->geofence_id === ($fence?->id ?? $existing->geofence_id)
            && $existing->request_hash === $requestHash
            && $existing->created_by === $actor
            && $existing->application_uuid === $application,
            409,
            'The operation UUID was already used for a different geofence activation.',
        );

        return $existing;
    }
}
