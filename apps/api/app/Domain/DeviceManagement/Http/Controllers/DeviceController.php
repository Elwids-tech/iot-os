<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Http\Controllers;

use App\Domain\Authorization\Support\CurrentOrganization;
use App\Domain\DeviceManagement\Data\DeviceDraftData;
use App\Domain\DeviceManagement\Http\Requests\DeviceDraftRequest;
use App\Domain\DeviceManagement\Http\Resources\DeviceResource;
use App\Domain\DeviceManagement\Models\Device;
use App\Domain\DeviceManagement\Services\DeviceRegistrationManager;
use App\Domain\DeviceProfile\Services\TenantDeviceDomainLocator;
use App\Domain\Shared\Exceptions\DomainInvariantViolation;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

final class DeviceController
{
    public function __construct(
        private readonly DeviceRegistrationManager $registration,
        private readonly TenantDeviceDomainLocator $locator,
    ) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        $organization = CurrentOrganization::from($request);
        Gate::authorize('viewAny', [Device::class, $organization]);
        $query = Device::query()
            ->whereBelongsTo($organization)
            ->with(['definitionAssignment.device', 'definitionAssignment.profileVersion', 'definitionAssignment.bindingVersion'])
            ->orderBy('name');
        if (is_string($request->query('state')) && $request->query('state') !== '') {
            $query->where('lifecycle_state', $request->query('state'));
        }
        if (is_string($request->query('search')) && $request->query('search') !== '') {
            $search = '%'.str_replace(['%', '_'], ['\%', '\_'], (string) $request->query('search')).'%';
            $query->where(static fn ($builder) => $builder->where('name', 'like', $search)->orWhere('external_id', 'like', $search));
        }

        return DeviceResource::collection($query->paginate(max(1, min(100, $request->integer('per_page', 25)))));
    }

    public function store(DeviceDraftRequest $request): JsonResponse
    {
        $organization = CurrentOrganization::from($request);
        Gate::authorize('create', [Device::class, $organization]);
        $validated = $request->validated();
        /** @var User $actor */
        $actor = $request->user();

        $device = DB::transaction(function () use ($organization, $validated, $actor): Device {
            $device = $this->registration->createDraft($organization, DeviceDraftData::fromArray($validated), $actor);
            if (isset($validated['profile_version_uuid'], $validated['binding_version_uuid'])) {
                Gate::authorize('assignDefinition', $device);
                $profileVersion = $this->locator->profileVersion($organization, $validated['profile_version_uuid']);
                $bindingVersion = $this->locator->bindingVersion($organization, $validated['binding_version_uuid']);
                $this->registration->replaceDefinitionAssignment(
                    $device,
                    $profileVersion,
                    $bindingVersion,
                    $device->etag(),
                    $actor,
                );
            }

            return $device;
        });

        return $this->deviceResponse($device, 201);
    }

    public function show(Request $request, string $device): JsonResponse
    {
        $model = $this->locator->device(CurrentOrganization::from($request), $device);
        Gate::authorize('view', $model);

        return $this->deviceResponse($model);
    }

    public function update(DeviceDraftRequest $request, string $device): JsonResponse
    {
        $model = $this->locator->device(CurrentOrganization::from($request), $device);
        Gate::authorize('update', $model);
        $validated = $request->validated();
        if (isset($validated['uuid']) && $validated['uuid'] !== $model->uuid) {
            throw new DomainInvariantViolation('A Device draft replacement cannot change its UUID.');
        }
        $updated = $this->registration->replaceDraft(
            $model,
            DeviceDraftData::fromArray($validated),
            $request->header('If-Match'),
        );

        return $this->deviceResponse($updated);
    }

    public function destroy(Request $request, string $device): Response
    {
        $model = $this->locator->device(CurrentOrganization::from($request), $device);
        Gate::authorize('delete', $model);
        $this->registration->deleteDraft($model, $request->header('If-Match'));

        return response()->noContent();
    }

    public function register(Request $request, string $device): JsonResponse
    {
        $model = $this->locator->device(CurrentOrganization::from($request), $device);
        Gate::authorize('register', $model);
        $registered = $this->registration->register($model, $request->header('If-Match'));

        return $this->deviceResponse($registered);
    }

    public function archive(Request $request, string $device): JsonResponse
    {
        $model = $this->locator->device(CurrentOrganization::from($request), $device);
        Gate::authorize('archive', $model);
        $archived = $this->registration->archive($model, $request->header('If-Match'));

        return $this->deviceResponse($archived);
    }

    private function deviceResponse(Device $device, int $status = 200): JsonResponse
    {
        $device->load([
            'definitionAssignment.device',
            'definitionAssignment.profileVersion',
            'definitionAssignment.bindingVersion',
        ]);

        return DeviceResource::make($device)
            ->additional(['etag' => $device->etag()])
            ->response()
            ->setStatusCode($status)
            ->withHeaders(['ETag' => $device->etag()]);
    }
}
