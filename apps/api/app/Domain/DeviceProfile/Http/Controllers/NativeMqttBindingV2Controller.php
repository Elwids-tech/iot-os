<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Http\Controllers;

use App\Domain\Authorization\Support\CurrentOrganization;
use App\Domain\DeviceProfile\Data\NativeMqttBindingV2AuthoringData;
use App\Domain\DeviceProfile\Enums\DefinitionContractVersion;
use App\Domain\DeviceProfile\Http\Requests\NativeMqttBindingV2AuthoringRequest;
use App\Domain\DeviceProfile\Http\Resources\NativeMqttBindingV2Resource;
use App\Domain\DeviceProfile\Models\TransportBinding;
use App\Domain\DeviceProfile\Services\DefinitionV2AuthoringManager;
use App\Domain\DeviceProfile\Services\TenantDeviceDomainLocator;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

final class NativeMqttBindingV2Controller
{
    public function __construct(
        private readonly DefinitionV2AuthoringManager $authoring,
        private readonly TenantDeviceDomainLocator $locator,
    ) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        $organization = CurrentOrganization::from($request);
        Gate::authorize('viewAny', [TransportBinding::class, $organization]);

        $query = TransportBinding::query()
            ->whereBelongsTo($organization)
            ->whereHas('versions', $this->v2Versions(...))
            ->with(['profile', 'versions' => $this->v2Versions(...)])
            ->orderBy('name');

        if (is_string($request->query('search')) && $request->query('search') !== '') {
            $search = '%'.str_replace(['%', '_'], ['\%', '\_'], (string) $request->query('search')).'%';
            $query->where(static fn ($builder) => $builder
                ->where('name', 'like', $search)
                ->orWhere('key', 'like', $search));
        }

        return NativeMqttBindingV2Resource::collection(
            $query->paginate(max(1, min(100, $request->integer('per_page', 25)))),
        );
    }

    public function store(NativeMqttBindingV2AuthoringRequest $request): JsonResponse
    {
        $organization = CurrentOrganization::from($request);
        Gate::authorize('create', [TransportBinding::class, $organization]);
        $data = NativeMqttBindingV2AuthoringData::fromArray($request->validated());
        $profile = $this->locator->profileV2($organization, $data->profileUuid());
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
        $model = $this->locator->bindingV2(CurrentOrganization::from($request), $binding);
        Gate::authorize('view', $model);

        return $this->response($model);
    }

    public function update(NativeMqttBindingV2AuthoringRequest $request, string $binding): JsonResponse
    {
        $model = $this->locator->bindingV2(CurrentOrganization::from($request), $binding);
        Gate::authorize('update', $model);
        $updated = $this->authoring->replaceBindingDraft(
            $model,
            NativeMqttBindingV2AuthoringData::fromArray($request->validated()),
            $request->header('If-Match'),
        );

        return $this->response($updated);
    }

    public function destroy(Request $request, string $binding): Response
    {
        $model = $this->locator->bindingV2(CurrentOrganization::from($request), $binding);
        Gate::authorize('delete', $model);
        $this->authoring->deleteBindingDraft($model, $request->header('If-Match'));

        return response()->noContent();
    }

    private function response(TransportBinding $binding, int $status = 200): JsonResponse
    {
        $binding->load(['profile', 'versions' => $this->v2Versions(...)]);

        return NativeMqttBindingV2Resource::make($binding)
            ->additional(['etag' => $binding->etag()])
            ->response()
            ->setStatusCode($status)
            ->withHeaders(['ETag' => $binding->etag()]);
    }

    private function v2Versions($query): void
    {
        $query
            ->where('contract_version', DefinitionContractVersion::V2->value)
            ->orderByDesc('version');
    }
}
