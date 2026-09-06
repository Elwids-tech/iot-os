<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Http\Controllers;

use App\Domain\DeviceProfiles\Actions\CompileDeviceProfile;
use App\Domain\DeviceProfiles\Actions\PublishDeviceProfile;
use App\Domain\DeviceProfiles\Actions\ValidateDeviceProfile;
use App\Domain\DeviceProfiles\Http\Resources\DeviceProfileArtifactResource;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Permissions\DeviceProfilePermission;
use App\Domain\DeviceProfiles\Services\DeviceProfileAuthoring;
use App\Domain\DeviceProfiles\Services\DeviceProfileAuthorization;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class DeviceProfileArtifactController
{
    public function __construct(
        private readonly DeviceProfileAuthorization $authorization,
        private readonly ValidateDeviceProfile $validate,
        private readonly CompileDeviceProfile $compile,
        private readonly PublishDeviceProfile $publish,
        private readonly DeviceProfileAuthoring $authoring,
    ) {}

    public function validate(Request $request, Organization $organization, DeviceProfile $profile): JsonResponse
    {
        $this->authorize($request, $organization, $profile, DeviceProfilePermission::VALIDATE);
        $values = $request->validate(['draft_revision' => ['sometimes', 'integer', 'min:1']]);

        return $this->authoring->snapshot($profile, $values['draft_revision'] ?? null, function (DeviceProfile $profile): JsonResponse {
            $diagnostics = $this->validate->diagnostics($profile);

            return response()->json(['data' => [
                'draft_revision' => $profile->draft_revision,
                'valid' => $diagnostics === [],
                'diagnostics' => array_map(static fn ($diagnostic): array => $diagnostic->toArray(), $diagnostics),
            ]]);
        });
    }

    public function compile(Request $request, Organization $organization, DeviceProfile $profile): JsonResponse
    {
        $this->authorize($request, $organization, $profile, DeviceProfilePermission::VALIDATE);
        $values = $request->validate(['draft_revision' => ['sometimes', 'integer', 'min:1']]);

        return $this->authoring->snapshot($profile, $values['draft_revision'] ?? null, function (DeviceProfile $profile): JsonResponse {
            $compiled = $this->compile->handle($profile, $profile->revision + 1);

            return response()->json(['data' => [
                'draft_revision' => $profile->draft_revision,
                'definition' => $compiled->definition,
                'definition_hash' => $compiled->hash,
                'revision' => $profile->revision + 1,
            ]]);
        });
    }

    public function publish(Request $request, Organization $organization, DeviceProfile $profile): JsonResponse
    {
        $this->authorize($request, $organization, $profile, DeviceProfilePermission::PUBLISH);
        $validated = $request->validate(['draft_revision' => ['required', 'integer', 'min:1']]);

        return DeviceProfileArtifactResource::make(
            $this->publish->handle($profile, $request->user(), $validated['draft_revision']),
        )->response()->setStatusCode(201);
    }

    public function index(Request $request, Organization $organization, DeviceProfile $profile): JsonResponse
    {
        $this->authorize($request, $organization, $profile, DeviceProfilePermission::VIEW);
        $request->validate(['page' => ['sometimes', 'integer', 'min:1']]);
        $artifacts = $profile->artifacts()->select(['uuid', 'revision', 'definition_hash', 'status', 'compiled_at'])->orderByDesc('revision')->paginate(25);

        return response()->json(['data' => $artifacts->items(), 'meta' => ['current_page' => $artifacts->currentPage(), 'last_page' => $artifacts->lastPage(), 'total' => $artifacts->total(), 'per_page' => 25, 'from' => $artifacts->firstItem(), 'to' => $artifacts->lastItem()]]);
    }

    public function active(Request $request, Organization $organization, DeviceProfile $profile): DeviceProfileArtifactResource
    {
        $this->authorize($request, $organization, $profile, DeviceProfilePermission::VIEW);
        $artifact = $profile->activeArtifact()->with('profile')->firstOrFail();

        return DeviceProfileArtifactResource::make($artifact);
    }

    public function show(Request $request, Organization $organization, DeviceProfile $profile, int $revision): DeviceProfileArtifactResource
    {
        $this->authorize($request, $organization, $profile, DeviceProfilePermission::VIEW);
        $artifact = $profile->artifacts()->with('profile')->where('revision', $revision)->firstOrFail();

        return DeviceProfileArtifactResource::make($artifact);
    }

    private function authorize(Request $request, Organization $organization, DeviceProfile $profile, DeviceProfilePermission $permission): void
    {
        $this->authorization->authorize($request->user(), $permission);
        $this->authorization->ensureOrganizationProfile($profile, $organization);
    }
}
