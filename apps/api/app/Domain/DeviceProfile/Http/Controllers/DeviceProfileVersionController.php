<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Http\Controllers;

use App\Domain\Authorization\Support\CurrentOrganization;
use App\Domain\DeviceProfile\Data\DeviceProfileAuthoringData;
use App\Domain\DeviceProfile\Http\Requests\DeviceProfileDefinitionRequest;
use App\Domain\DeviceProfile\Http\Resources\DeviceProfileVersionResource;
use App\Domain\DeviceProfile\Models\DeviceProfileVersion;
use App\Domain\DeviceProfile\Services\DefinitionAuthoringManager;
use App\Domain\DeviceProfile\Services\TenantDeviceDomainLocator;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

final class DeviceProfileVersionController
{
    public function __construct(
        private readonly DefinitionAuthoringManager $authoring,
        private readonly TenantDeviceDomainLocator $locator,
    ) {}

    public function index(Request $request, string $profile): AnonymousResourceCollection
    {
        $catalog = $this->locator->profile(CurrentOrganization::from($request), $profile);
        Gate::authorize('view', $catalog);

        return DeviceProfileVersionResource::collection(
            $catalog->versions()->with('profile')->orderByDesc('version')->paginate(max(1, min(100, $request->integer('per_page', 25)))),
        );
    }

    public function store(DeviceProfileDefinitionRequest $request, string $profile): JsonResponse
    {
        $catalog = $this->locator->profile(CurrentOrganization::from($request), $profile);
        Gate::authorize('update', $catalog);
        /** @var User $actor */
        $actor = $request->user();
        $version = $this->authoring->createProfileVersionDraft(
            $catalog,
            DeviceProfileAuthoringData::fromArray($request->validated()),
            $actor,
        );

        return $this->versionResponse($version, 201);
    }

    public function show(Request $request, string $version): JsonResponse
    {
        $model = $this->locator->profileVersion(CurrentOrganization::from($request), $version)->load('profile');
        Gate::authorize('view', $model);

        return $this->versionResponse($model);
    }

    public function update(DeviceProfileDefinitionRequest $request, string $version): JsonResponse
    {
        $model = $this->locator->profileVersion(CurrentOrganization::from($request), $version)->load('profile');
        Gate::authorize('update', $model);
        $updated = $this->authoring->replaceProfileVersionDraft(
            $model,
            DeviceProfileAuthoringData::fromArray($request->validated()),
            $request->header('If-Match'),
        )->load('profile');

        return $this->versionResponse($updated);
    }

    public function destroy(Request $request, string $version): Response
    {
        $model = $this->locator->profileVersion(CurrentOrganization::from($request), $version)->load('profile');
        Gate::authorize('delete', $model);
        $this->authoring->deleteProfileVersion($model, $request->header('If-Match'));

        return response()->noContent();
    }

    public function clone(Request $request, string $version): JsonResponse
    {
        $model = $this->locator->profileVersion(CurrentOrganization::from($request), $version)->load('profile');
        Gate::authorize('view', $model);
        Gate::authorize('update', $model->profile);
        /** @var User $actor */
        $actor = $request->user();

        return $this->versionResponse($this->authoring->cloneProfileVersion($model, $actor), 201);
    }

    private function versionResponse(DeviceProfileVersion $version, int $status = 200): JsonResponse
    {
        $version->loadMissing('profile');

        return DeviceProfileVersionResource::make($version)
            ->additional(['etag' => $version->etag()])
            ->response()
            ->setStatusCode($status)
            ->withHeaders(['ETag' => $version->etag()]);
    }
}
