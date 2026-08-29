<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Http\Controllers;

use App\Domain\Authorization\Support\CurrentOrganization;
use App\Domain\DeviceProfile\Data\DeviceProfileAuthoringData;
use App\Domain\DeviceProfile\Http\Requests\CatalogMetadataRequest;
use App\Domain\DeviceProfile\Http\Requests\DeviceProfileDefinitionRequest;
use App\Domain\DeviceProfile\Http\Resources\DeviceProfileResource;
use App\Domain\DeviceProfile\Models\DeviceProfile;
use App\Domain\DeviceProfile\Services\DefinitionAuthoringManager;
use App\Domain\DeviceProfile\Services\TenantDeviceDomainLocator;
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
            ->withCount('versions')
            ->orderBy('name');
        if ($request->boolean('include_archived') === false) {
            $query->whereNull('archived_at');
        }
        if (is_string($request->query('search')) && $request->query('search') !== '') {
            $search = '%'.str_replace(['%', '_'], ['\%', '\_'], (string) $request->query('search')).'%';
            $query->where(static fn ($builder) => $builder->where('name', 'like', $search)->orWhere('key', 'like', $search));
        }

        return DeviceProfileResource::collection($query->paginate($this->perPage($request)));
    }

    public function store(DeviceProfileDefinitionRequest $request): JsonResponse
    {
        $organization = CurrentOrganization::from($request);
        Gate::authorize('create', [DeviceProfile::class, $organization]);
        /** @var User $actor */
        $actor = $request->user();
        $version = $this->authoring->createProfileDraft(
            $organization,
            DeviceProfileAuthoringData::fromArray($request->validated()),
            $actor,
        );
        $profile = $version->profile->load(['versions.profile']);

        return DeviceProfileResource::make($profile)
            ->additional(['etag' => $profile->etag()])
            ->response()
            ->setStatusCode(201)
            ->withHeaders(['ETag' => $profile->etag()]);
    }

    public function show(Request $request, string $profile): JsonResponse
    {
        $model = $this->locator->profile(CurrentOrganization::from($request), $profile);
        Gate::authorize('view', $model);
        $model->load(['versions' => static fn ($query) => $query->with('profile')->orderByDesc('version')]);

        return DeviceProfileResource::make($model)
            ->additional(['etag' => $model->etag()])
            ->response()
            ->withHeaders(['ETag' => $model->etag()]);
    }

    public function update(CatalogMetadataRequest $request, string $profile): JsonResponse
    {
        $model = $this->locator->profile(CurrentOrganization::from($request), $profile);
        Gate::authorize('update', $model);
        $validated = $request->validated();
        $updated = $this->authoring->updateProfileMetadata(
            $model,
            (string) ($validated['name'] ?? $model->name),
            array_key_exists('description', $validated) ? $validated['description'] : $model->description,
            $request->header('If-Match'),
        );

        return DeviceProfileResource::make($updated)
            ->additional(['etag' => $updated->etag()])
            ->response()
            ->withHeaders(['ETag' => $updated->etag()]);
    }

    public function destroy(Request $request, string $profile): Response
    {
        $model = $this->locator->profile(CurrentOrganization::from($request), $profile);
        Gate::authorize('delete', $model);
        $this->authoring->deleteProfile($model, $request->header('If-Match'));

        return response()->noContent();
    }

    public function archive(Request $request, string $profile): JsonResponse
    {
        $model = $this->locator->profile(CurrentOrganization::from($request), $profile);
        Gate::authorize('update', $model);
        $archived = $this->authoring->archiveProfile($model, $request->header('If-Match'));

        return DeviceProfileResource::make($archived)
            ->additional(['etag' => $archived->etag()])
            ->response()
            ->withHeaders(['ETag' => $archived->etag()]);
    }

    private function perPage(Request $request): int
    {
        return max(1, min(100, $request->integer('per_page', 25)));
    }
}
