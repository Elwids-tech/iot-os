<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Http\Controllers;

use App\Domain\Authorization\Support\CurrentOrganization;
use App\Domain\DeviceProfile\Data\NativeMqttBindingAuthoringData;
use App\Domain\DeviceProfile\Http\Requests\NativeMqttBindingAuthoringRequest;
use App\Domain\DeviceProfile\Http\Resources\NativeMqttBindingResource;
use App\Domain\DeviceProfile\Models\TransportBinding;
use App\Domain\DeviceProfile\Services\DefinitionAuthoringManager;
use App\Domain\DeviceProfile\Services\TenantDeviceDomainLocator;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

final class NativeMqttBindingController
{
    public function __construct(
        private readonly DefinitionAuthoringManager $authoring,
        private readonly TenantDeviceDomainLocator $locator,
    ) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        $organization = CurrentOrganization::from($request);
        Gate::authorize('viewAny', [TransportBinding::class, $organization]);

        $query = TransportBinding::query()
            ->whereBelongsTo($organization)
            ->whereHas('versions')
            ->with(['profile', 'versions' => fn ($query) => $query->orderByDesc('version')])
            ->orderBy('name');

        if (is_string($request->query('search')) && $request->query('search') !== '') {
            $search = '%'.str_replace(['%', '_'], ['\%', '\_'], (string) $request->query('search')).'%';
            $query->where(static fn ($builder) => $builder
                ->where('name', 'like', $search)
                ->orWhere('key', 'like', $search));
        }

        return NativeMqttBindingResource::collection(
            $query->paginate(max(1, min(100, $request->integer('per_page', 25)))),
        );
    }

    public function store(NativeMqttBindingAuthoringRequest $request): JsonResponse
    {
        $organization = CurrentOrganization::from($request);
        Gate::authorize('create', [TransportBinding::class, $organization]);
        $data = NativeMqttBindingAuthoringData::fromArray($request->validated());
        $profile = $this->locator->profile($organization, $data->profileUuid());
        $profileVersion = $this->locator->profileVersion($organization, $data->profileVersionUuid());
        /** @var User $actor */
        $actor = $request->user();
        $binding = $this->authoring->createBindingDraft(
            $organization,
            $profile,
            $profileVersion,
            $data,
            $actor,
        );

        return $this->response($binding, 201);
    }

    public function show(Request $request, string $binding): JsonResponse
    {
        $model = $this->locator->binding(CurrentOrganization::from($request), $binding);
        Gate::authorize('view', $model);

        return $this->response($model);
    }

    public function update(NativeMqttBindingAuthoringRequest $request, string $binding): JsonResponse
    {
        $model = $this->locator->binding(CurrentOrganization::from($request), $binding);
        Gate::authorize('update', $model);
        $updated = $this->authoring->replaceBindingDraft(
            $model,
            NativeMqttBindingAuthoringData::fromArray($request->validated()),
            $request->header('If-Match'),
        );

        return $this->response($updated);
    }

    public function destroy(Request $request, string $binding): Response
    {
        $model = $this->locator->binding(CurrentOrganization::from($request), $binding);
        Gate::authorize('delete', $model);
        $this->authoring->deleteBindingDraft($model, $request->header('If-Match'));

        return response()->noContent();
    }

    private function response(TransportBinding $binding, int $status = 200): JsonResponse
    {
        $binding->load(['profile', 'versions' => fn ($query) => $query->orderByDesc('version')]);

        return NativeMqttBindingResource::make($binding)
            ->additional(['etag' => $binding->etag()])
            ->response()
            ->setStatusCode($status)
            ->withHeaders(['ETag' => $binding->etag()]);
    }

}
