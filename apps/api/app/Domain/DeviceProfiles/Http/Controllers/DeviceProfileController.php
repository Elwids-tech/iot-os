<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Http\Controllers;

use App\Domain\DeviceProfiles\Actions\CreateDeviceProfile;
use App\Domain\DeviceProfiles\Actions\UpdateDeviceProfile;
use App\Domain\DeviceProfiles\Enums\DeviceProfileStatus;
use App\Domain\DeviceProfiles\Http\Requests\StoreDeviceProfileRequest;
use App\Domain\DeviceProfiles\Http\Requests\UpdateDeviceProfileRequest;
use App\Domain\DeviceProfiles\Http\Resources\DeviceProfileResource;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Permissions\DeviceProfilePermission;
use App\Domain\DeviceProfiles\Services\DeviceProfileAuthoring;
use App\Domain\DeviceProfiles\Services\DeviceProfileAuthorization;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;
use LogicException;

final class DeviceProfileController
{
    public function __construct(
        private readonly DeviceProfileAuthorization $authorization,
        private readonly CreateDeviceProfile $create,
        private readonly UpdateDeviceProfile $update,
    ) {}

    public function index(Request $request, Organization $organization): AnonymousResourceCollection
    {
        $this->authorization->authorize($request->user(), DeviceProfilePermission::VIEW_ANY);

        $filters = $request->validate([
            'search' => ['nullable', 'string', 'max:255'],
            'status' => ['nullable', Rule::in(['draft', 'published', 'archived'])],
            'category' => ['nullable', 'string', 'max:255'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);

        return DeviceProfileResource::collection(
            DeviceProfile::query()
                ->where('organization_id', $organization->getKey())
                ->withCount('parameters')
                ->when($filters['search'] ?? null, fn ($query, $search) => $query->where(fn ($q) => $q->whereRaw('LOWER(name) LIKE ?', ['%'.mb_strtolower($search).'%'])->orWhereRaw('LOWER(code) LIKE ?', ['%'.mb_strtolower($search).'%'])))
                ->when($filters['status'] ?? null, fn ($query, $status) => $query->where('status', $status))
                ->when($filters['category'] ?? null, fn ($query, $category) => $query->where('category', $category))
                ->orderBy('name')
                ->paginate((int) $request->integer('per_page', 25)),
        );
    }

    public function store(StoreDeviceProfileRequest $request, Organization $organization): JsonResponse
    {
        $this->authorization->authorize($request->user(), DeviceProfilePermission::CREATE);

        return DeviceProfileResource::make($this->create->handle(
            $organization,
            $request->user(),
            $request->validated(),
        ))->response()->setStatusCode(201);
    }

    public function show(Request $request, Organization $organization, DeviceProfile $profile): DeviceProfileResource
    {
        $this->authorization->authorize($request->user(), DeviceProfilePermission::VIEW);
        $this->authorization->ensureOrganizationProfile($profile, $organization);

        return app(DeviceProfileAuthoring::class)->snapshot($profile, null,
            fn ($locked) => DeviceProfileResource::make($this->authoringState($locked)));

    }

    public function update(UpdateDeviceProfileRequest $request, Organization $organization, DeviceProfile $profile): DeviceProfileResource
    {
        $this->authorization->authorize($request->user(), DeviceProfilePermission::UPDATE);
        $this->authorization->ensureOrganizationProfile($profile, $organization);
        $validated = $request->validated();
        $expectedDraftRevision = $validated['draft_revision'];
        unset($validated['draft_revision']);

        return DeviceProfileResource::make($this->authoringState(
            $this->update->handle($profile, $request->user(), $validated, $expectedDraftRevision),
        ));
    }

    public function destroy(Request $request, Organization $organization, DeviceProfile $profile): Response
    {
        $this->authorization->authorize($request->user(), DeviceProfilePermission::DELETE_DRAFT);
        $this->authorization->ensureOrganizationProfile($profile, $organization);
        $revision = $request->validate(['draft_revision' => ['required', 'integer', 'min:1']])['draft_revision'];
        app(DeviceProfileAuthoring::class)->snapshot($profile, $revision, function (DeviceProfile $locked): void {
            abort_unless($locked->status === DeviceProfileStatus::DRAFT, 422, 'Only an unused draft may be deleted.');
            try {
                $locked->delete();
            } catch (LogicException $exception) {
                abort(422, $exception->getMessage());
            }
        });

        return response()->noContent();
    }

    public function authoringState(DeviceProfile $profile): DeviceProfile
    {
        return $profile->load([
            'parameterGroups' => fn ($query) => $query->orderBy('sort_order')->orderBy('code'),
            'parameters' => fn ($query) => $query->orderBy('sort_order')->orderBy('key'),
            'parameters.group',
            'parameters.calculation.inputs.parameter',
            'alarmTemplates.parameterReferences.parameter',
            'activeArtifact.profile',
        ]);
    }
}
