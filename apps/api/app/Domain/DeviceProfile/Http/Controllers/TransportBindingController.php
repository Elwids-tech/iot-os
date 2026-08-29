<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Http\Controllers;

use App\Domain\Authorization\Support\CurrentOrganization;
use App\Domain\DeviceProfile\Data\NativeMqttBindingAuthoringData;
use App\Domain\DeviceProfile\Http\Requests\CatalogMetadataRequest;
use App\Domain\DeviceProfile\Http\Requests\NativeMqttBindingDefinitionRequest;
use App\Domain\DeviceProfile\Http\Resources\TransportBindingResource;
use App\Domain\DeviceProfile\Models\TransportBinding;
use App\Domain\DeviceProfile\Services\DefinitionAuthoringManager;
use App\Domain\DeviceProfile\Services\TenantDeviceDomainLocator;
use App\Domain\Shared\Exceptions\DomainInvariantViolation;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

final class TransportBindingController
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
            ->with('profile')
            ->withCount('versions')
            ->orderBy('name');
        if (! $request->boolean('include_archived')) {
            $query->whereNull('archived_at');
        }
        if (is_string($request->query('search')) && $request->query('search') !== '') {
            $search = '%'.str_replace(['%', '_'], ['\%', '\_'], (string) $request->query('search')).'%';
            $query->where(static fn ($builder) => $builder->where('name', 'like', $search)->orWhere('key', 'like', $search));
        }

        return TransportBindingResource::collection($query->paginate(max(1, min(100, $request->integer('per_page', 25)))));
    }

    public function store(NativeMqttBindingDefinitionRequest $request): JsonResponse
    {
        $organization = CurrentOrganization::from($request);
        Gate::authorize('create', [TransportBinding::class, $organization]);
        $data = NativeMqttBindingAuthoringData::fromArray($request->validated());
        $profile = $this->locator->profile($organization, $data->profileUuid());
        $profileVersion = $this->locator->profileVersion($organization, $data->profileVersionUuid());
        if ($profileVersion->device_profile_id !== $profile->getKey()) {
            throw new DomainInvariantViolation('The selected Profile Version does not belong to the selected Device Profile.');
        }
        Gate::authorize('view', $profile);
        /** @var User $actor */
        $actor = $request->user();
        $version = $this->authoring->createBindingDraft($profile, $profileVersion, $data, $actor);
        $binding = $version->binding->load(['profile', 'versions.binding', 'versions.profileVersion']);

        return TransportBindingResource::make($binding)
            ->additional(['etag' => $binding->etag()])
            ->response()
            ->setStatusCode(201)
            ->withHeaders(['ETag' => $binding->etag()]);
    }

    public function show(Request $request, string $binding): JsonResponse
    {
        $model = $this->locator->binding(CurrentOrganization::from($request), $binding);
        Gate::authorize('view', $model);
        $model->load([
            'profile',
            'versions' => static fn ($query) => $query->with(['binding', 'profileVersion'])->orderByDesc('version'),
        ]);

        return TransportBindingResource::make($model)
            ->additional(['etag' => $model->etag()])
            ->response()
            ->withHeaders(['ETag' => $model->etag()]);
    }

    public function update(CatalogMetadataRequest $request, string $binding): JsonResponse
    {
        $model = $this->locator->binding(CurrentOrganization::from($request), $binding);
        Gate::authorize('update', $model);
        $validated = $request->validated();
        $updated = $this->authoring->updateBindingMetadata(
            $model,
            (string) ($validated['name'] ?? $model->name),
            array_key_exists('description', $validated) ? $validated['description'] : $model->description,
            $request->header('If-Match'),
        )->load('profile');

        return TransportBindingResource::make($updated)
            ->additional(['etag' => $updated->etag()])
            ->response()
            ->withHeaders(['ETag' => $updated->etag()]);
    }

    public function destroy(Request $request, string $binding): Response
    {
        $model = $this->locator->binding(CurrentOrganization::from($request), $binding);
        Gate::authorize('delete', $model);
        $this->authoring->deleteBinding($model, $request->header('If-Match'));

        return response()->noContent();
    }

    public function archive(Request $request, string $binding): JsonResponse
    {
        $model = $this->locator->binding(CurrentOrganization::from($request), $binding);
        Gate::authorize('update', $model);
        $archived = $this->authoring->archiveBinding($model, $request->header('If-Match'))->load('profile');

        return TransportBindingResource::make($archived)
            ->additional(['etag' => $archived->etag()])
            ->response()
            ->withHeaders(['ETag' => $archived->etag()]);
    }
}
