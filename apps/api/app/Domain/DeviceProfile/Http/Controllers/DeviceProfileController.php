<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Http\Controllers;

use App\Domain\Authorization\Support\CurrentOrganization;
use App\Domain\DeviceProfile\Data\DeviceProfileAuthoringData;
use App\Domain\DeviceProfile\Enums\DefinitionState;
use App\Domain\DeviceProfile\Http\Requests\DeviceProfileAuthoringRequest;
use App\Domain\DeviceProfile\Http\Resources\DeviceProfileResource;
use App\Domain\DeviceProfile\Models\DeviceProfile;
use App\Domain\DeviceProfile\Services\DefinitionAuthoringManager;
use App\Domain\DeviceProfile\Services\TenantDeviceDomainLocator;
use App\Domain\Shared\Exceptions\DomainInvariantViolation;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

final class DeviceProfileController
{
    public function __construct(
        private readonly DefinitionAuthoringManager $authoring,
        private readonly TenantDeviceDomainLocator $locator,
    ) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        $organization = CurrentOrganization::from($request);
        Gate::authorize('viewAny', [DeviceProfile::class, $organization]);

        $query = DeviceProfile::query()
            ->whereBelongsTo($organization)
            ->whereHas('versions')
            ->with(['versions' => fn ($query) => $query->orderByDesc('version')])
            ->orderBy('name');

        if (is_string($request->query('search')) && $request->query('search') !== '') {
            $search = '%'.str_replace(['%', '_'], ['\%', '\_'], (string) $request->query('search')).'%';
            $query->where(static fn ($builder) => $builder
                ->where('name', 'like', $search)
                ->orWhere('key', 'like', $search));
        }

        return DeviceProfileResource::collection(
            $query->paginate(max(1, min(100, $request->integer('per_page', 25)))),
        );
    }

    public function store(DeviceProfileAuthoringRequest $request): JsonResponse
    {
        $organization = CurrentOrganization::from($request);
        Gate::authorize('create', [DeviceProfile::class, $organization]);
        /** @var User $actor */
        $actor = $request->user();
        $profile = $this->authoring->createProfileDraft(
            $organization,
            DeviceProfileAuthoringData::fromArray($request->validated()),
            $actor,
        );

        return $this->response($profile, 201);
    }

    public function show(Request $request, string $profile): JsonResponse
    {
        $model = $this->locator->profile(CurrentOrganization::from($request), $profile);
        Gate::authorize('view', $model);

        return $this->response($model);
    }

    public function update(DeviceProfileAuthoringRequest $request, string $profile): JsonResponse
    {
        $model = $this->locator->profile(CurrentOrganization::from($request), $profile);
        Gate::authorize('update', $model);
        $updated = $this->authoring->replaceProfileDraft(
            $model,
            DeviceProfileAuthoringData::fromArray($request->validated()),
            $request->header('If-Match'),
        );

        return $this->response($updated);
    }

    public function cloneCompatible(Request $request, string $profile): JsonResponse
    {
        $model = $this->locator->profile(CurrentOrganization::from($request), $profile);
        Gate::authorize('update', $model);

        $source = $model->versions()
            ->where('state', DefinitionState::PUBLISHED->value)
            ->orderByDesc('version')
            ->first();

        if ($source === null) {
            throw new DomainInvariantViolation('Only a published Device Profile Version can be cloned compatibly.');
        }

        /** @var User $actor */
        $actor = $request->user();
        $this->authoring->cloneCompatibleProfileVersion($source, $actor);

        return $this->response($model, 201);
    }

    public function destroyDraftVersion(Request $request, string $profile): JsonResponse
    {
        $model = $this->locator->profile(CurrentOrganization::from($request), $profile);
        Gate::authorize('delete', $model);

        $profile = $this->authoring->deleteLatestCompatibleProfileDraft(
            $model,
            $request->header('If-Match'),
        );

        return $this->response($profile);
    }

    public function destroy(Request $request, string $profile): Response
    {
        $model = $this->locator->profile(CurrentOrganization::from($request), $profile);
        Gate::authorize('delete', $model);
        $this->authoring->deleteProfileDraft($model, $request->header('If-Match'));

        return response()->noContent();
    }

    private function response(DeviceProfile $profile, int $status = 200): JsonResponse
    {
        $profile->load(['versions' => fn ($query) => $query->orderByDesc('version')]);

        return DeviceProfileResource::make($profile)
            ->additional(['etag' => $profile->etag()])
            ->response()
            ->setStatusCode($status)
            ->withHeaders(['ETag' => $profile->etag()]);
    }
}
