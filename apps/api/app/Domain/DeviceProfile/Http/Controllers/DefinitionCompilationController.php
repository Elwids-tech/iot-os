<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Http\Controllers;

use App\Domain\Authorization\Support\CurrentOrganization;
use App\Domain\DeviceProfile\Http\Requests\DefinitionCompilationRequest;
use App\Domain\DeviceProfile\Http\Resources\DeviceProfileResource;
use App\Domain\DeviceProfile\Http\Resources\NativeMqttBindingResource;
use App\Domain\DeviceProfile\Services\DefinitionPublicationManager;
use App\Domain\DeviceProfile\Services\TenantDeviceDomainLocator;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;

final readonly class DefinitionCompilationController
{
    public function __construct(
        private DefinitionPublicationManager $publications,
        private TenantDeviceDomainLocator $locator,
    ) {}

    public function preview(DefinitionCompilationRequest $request): JsonResponse
    {
        $context = $this->context($request);
        Gate::authorize('view', $context['profile']);
        Gate::authorize('view', $context['binding']);

        $result = $this->publications->preview(
            $context['organization'],
            $context['profile'],
            $context['profile_version'],
            $context['binding'],
            $context['binding_version'],
            $context['profile_data'],
            $context['binding_data'],
            $request->gatewayData(),
            $request->routeData(),
            $request->fixtures(),
        );

        return response()->json(['data' => $result->toArray()]);
    }

    public function publish(DefinitionCompilationRequest $request): JsonResponse
    {
        $context = $this->context($request);
        Gate::authorize('publish', $context['profile']);
        Gate::authorize('publish', $context['binding']);

        [$result, $profile, $binding] = $this->publications->publish(
            $context['organization'],
            $context['profile'],
            $context['profile_version'],
            $context['binding'],
            $context['binding_version'],
            $context['profile_data'],
            $context['binding_data'],
            $request->gatewayData(),
            $request->routeData(),
            $request->fixtures(),
            $request->header('If-Match-Profile'),
            $request->header('If-Match-Binding'),
        );

        if (! $result->valid) {
            return response()->json([
                'message' => 'Definition compilation failed. Review the diagnostics before publishing.',
                'data' => $result->toArray(),
            ], 422);
        }

        return response()->json([
            'data' => [
                'profile' => DeviceProfileResource::make($profile)->resolve($request),
                'binding' => NativeMqttBindingResource::make($binding)->resolve($request),
                'compile' => $result->toArray(),
            ],
        ])->withHeaders([
            'ETag-Profile' => $profile->etag(),
            'ETag-Binding' => $binding->etag(),
        ]);
    }

    /** @return array<string, mixed> */
    private function context(DefinitionCompilationRequest $request): array
    {
        $organization = CurrentOrganization::from($request);

        if ($request->validated('organization_uuid') !== $organization->uuid) {
            abort(422, 'Compile Organization must match the authenticated tenant context.');
        }

        $profileData = $request->profileData();
        $bindingData = $request->bindingData();
        $profile = $this->locator->profile($organization, $profileData->profileUuid());
        $profileVersion = $this->locator->profileVersion($organization, $profileData->versionUuid());
        $binding = $this->locator->binding($organization, $bindingData->bindingUuid());
        $bindingVersion = $this->locator->bindingVersion($organization, $bindingData->versionUuid());

        return compact(
            'organization',
            'profile',
            'profileVersion',
            'binding',
            'bindingVersion',
            'profileData',
            'bindingData',
        ) + [
            'profile_version' => $profileVersion,
            'binding_version' => $bindingVersion,
            'profile_data' => $profileData,
            'binding_data' => $bindingData,
        ];
    }
}
