<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Http\Controllers;

use App\Domain\Authorization\Support\CurrentOrganization;
use App\Domain\DeviceManagement\Http\Requests\DefinitionAssignmentRequest;
use App\Domain\DeviceManagement\Http\Resources\DeviceDefinitionAssignmentResource;
use App\Domain\DeviceManagement\Models\DeviceDefinitionAssignment;
use App\Domain\DeviceManagement\Services\DeviceRegistrationManager;
use App\Domain\DeviceProfile\Services\TenantDeviceDomainLocator;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

final class DeviceDefinitionAssignmentController
{
    public function __construct(
        private readonly DeviceRegistrationManager $registration,
        private readonly TenantDeviceDomainLocator $locator,
    ) {}

    public function show(Request $request, string $device): JsonResponse
    {
        $model = $this->locator->device(CurrentOrganization::from($request), $device);
        Gate::authorize('view', $model);
        $assignment = $model->definitionAssignment()
            ->with(['device', 'profileVersion', 'bindingVersion', 'gatewayRoute'])
            ->firstOrFail();
        Gate::authorize('view', $assignment);

        return $this->assignmentResponse($assignment);
    }

    public function update(DefinitionAssignmentRequest $request, string $device): JsonResponse
    {
        $organization = CurrentOrganization::from($request);
        $model = $this->locator->device($organization, $device);
        $existing = $model->definitionAssignment()->first();
        if ($existing instanceof DeviceDefinitionAssignment) {
            Gate::authorize('update', $existing);
        } else {
            Gate::authorize('assignDefinition', $model);
        }
        $validated = $request->validated();
        $profileVersion = $this->locator->profileVersion($organization, $validated['profile_version_uuid']);
        $bindingVersion = $this->locator->bindingVersion($organization, $validated['binding_version_uuid']);
        /** @var User $actor */
        $actor = $request->user();
        $assignment = $this->registration->replaceDefinitionAssignment(
            $model,
            $profileVersion,
            $bindingVersion,
            $request->header('If-Match'),
            $actor,
        );

        return $this->assignmentResponse($assignment);
    }

    private function assignmentResponse(DeviceDefinitionAssignment $assignment): JsonResponse
    {
        $assignment->loadMissing(['device', 'profileVersion', 'bindingVersion', 'gatewayRoute']);

        return DeviceDefinitionAssignmentResource::make($assignment)
            ->additional(['etag' => $assignment->etag()])
            ->response()
            ->setStatusCode(200)
            ->withHeaders(['ETag' => $assignment->etag()]);
    }
}
