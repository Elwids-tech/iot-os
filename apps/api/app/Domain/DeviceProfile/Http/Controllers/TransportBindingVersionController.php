<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Http\Controllers;

use App\Domain\Authorization\Support\CurrentOrganization;
use App\Domain\DeviceProfile\Data\NativeMqttBindingAuthoringData;
use App\Domain\DeviceProfile\Http\Requests\NativeMqttBindingDefinitionRequest;
use App\Domain\DeviceProfile\Http\Resources\TransportBindingVersionResource;
use App\Domain\DeviceProfile\Models\TransportBindingVersion;
use App\Domain\DeviceProfile\Services\DefinitionAuthoringManager;
use App\Domain\DeviceProfile\Services\TenantDeviceDomainLocator;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

final class TransportBindingVersionController
{
    public function __construct(
        private readonly DefinitionAuthoringManager $authoring,
        private readonly TenantDeviceDomainLocator $locator,
    ) {}

    public function index(Request $request, string $binding): AnonymousResourceCollection
    {
        $catalog = $this->locator->binding(CurrentOrganization::from($request), $binding);
        Gate::authorize('view', $catalog);

        return TransportBindingVersionResource::collection(
            $catalog->versions()
                ->with(['binding', 'profileVersion'])
                ->orderByDesc('version')
                ->paginate(max(1, min(100, $request->integer('per_page', 25)))),
        );
    }

    public function store(NativeMqttBindingDefinitionRequest $request, string $binding): JsonResponse
    {
        $organization = CurrentOrganization::from($request);
        $catalog = $this->locator->binding($organization, $binding);
        Gate::authorize('update', $catalog);
        $data = NativeMqttBindingAuthoringData::fromArray($request->validated());
        $profileVersion = $this->locator->profileVersion($organization, $data->profileVersionUuid());
        /** @var User $actor */
        $actor = $request->user();
        $version = $this->authoring->createBindingVersionDraft($catalog, $profileVersion, $data, $actor);

        return $this->versionResponse($version, 201);
    }

    public function show(Request $request, string $version): JsonResponse
    {
        $model = $this->locator->bindingVersion(CurrentOrganization::from($request), $version)
            ->load(['binding', 'profileVersion']);
        Gate::authorize('view', $model);

        return $this->versionResponse($model);
    }

    public function update(NativeMqttBindingDefinitionRequest $request, string $version): JsonResponse
    {
        $model = $this->locator->bindingVersion(CurrentOrganization::from($request), $version)
            ->load(['binding', 'profileVersion']);
        Gate::authorize('update', $model);
        $updated = $this->authoring->replaceBindingVersionDraft(
            $model,
            NativeMqttBindingAuthoringData::fromArray($request->validated()),
            $request->header('If-Match'),
        )->load(['binding', 'profileVersion']);

        return $this->versionResponse($updated);
    }

    public function destroy(Request $request, string $version): Response
    {
        $model = $this->locator->bindingVersion(CurrentOrganization::from($request), $version)
            ->load(['binding', 'profileVersion']);
        Gate::authorize('delete', $model);
        $this->authoring->deleteBindingVersion($model, $request->header('If-Match'));

        return response()->noContent();
    }

    public function clone(Request $request, string $version): JsonResponse
    {
        $model = $this->locator->bindingVersion(CurrentOrganization::from($request), $version)
            ->load(['binding', 'profileVersion']);
        Gate::authorize('view', $model);
        Gate::authorize('update', $model->binding);
        /** @var User $actor */
        $actor = $request->user();

        return $this->versionResponse($this->authoring->cloneBindingVersion($model, $actor), 201);
    }

    private function versionResponse(TransportBindingVersion $version, int $status = 200): JsonResponse
    {
        $version->loadMissing(['binding', 'profileVersion']);

        return TransportBindingVersionResource::make($version)
            ->additional(['etag' => $version->etag()])
            ->response()
            ->setStatusCode($status)
            ->withHeaders(['ETag' => $version->etag()]);
    }
}
