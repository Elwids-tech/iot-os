<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Http\Controllers;

use App\Domain\Authorization\Support\CurrentOrganization;
use App\Domain\DeviceProfile\Data\DeviceProfileV2AuthoringData;
use App\Domain\DeviceProfile\Enums\DefinitionContractVersion;
use App\Domain\DeviceProfile\Http\Requests\DeviceProfileV2AuthoringRequest;
use App\Domain\DeviceProfile\Http\Resources\DeviceProfileV2Resource;
use App\Domain\DeviceProfile\Models\DeviceProfile;
use App\Domain\DeviceProfile\Services\DefinitionV2AuthoringManager;
use App\Domain\DeviceProfile\Services\TenantDeviceDomainLocator;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

final class DeviceProfileV2Controller
{
    public function __construct(
        private readonly DefinitionV2AuthoringManager $authoring,
        private readonly TenantDeviceDomainLocator $locator,
    ) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        $organization = CurrentOrganization::from($request);
        Gate::authorize('viewAny', [DeviceProfile::class, $organization]);

        $query = DeviceProfile::query()
            ->whereBelongsTo($organization)
            ->whereHas('versions', $this->v2Versions(...))
            ->with(['versions' => $this->v2Versions(...)])
            ->orderBy('name');

        if (is_string($request->query('search')) && $request->query('search') !== '') {
            $search = '%'.str_replace(['%', '_'], ['\%', '\_'], (string) $request->query('search')).'%';
            $query->where(static fn ($builder) => $builder
                ->where('name', 'like', $search)
                ->orWhere('key', 'like', $search));
        }

        return DeviceProfileV2Resource::collection(
            $query->paginate(max(1, min(100, $request->integer('per_page', 25)))),
        );
    }

    public function store(DeviceProfileV2AuthoringRequest $request): JsonResponse
    {
        $organization = CurrentOrganization::from($request);
        Gate::authorize('create', [DeviceProfile::class, $organization]);
        /** @var User $actor */
        $actor = $request->user();
        $profile = $this->authoring->createProfileDraft(
            $organization,
            DeviceProfileV2AuthoringData::fromArray($request->validated()),
            $actor,
        );

        return $this->response($profile, 201);
    }

    public function show(Request $request, string $profile): JsonResponse
    {
        $model = $this->locator->profileV2(CurrentOrganization::from($request), $profile);
        Gate::authorize('view', $model);

        return $this->response($model);
    }

    public function update(DeviceProfileV2AuthoringRequest $request, string $profile): JsonResponse
    {
        $model = $this->locator->profileV2(CurrentOrganization::from($request), $profile);
        Gate::authorize('update', $model);
        $updated = $this->authoring->replaceProfileDraft(
            $model,
            DeviceProfileV2AuthoringData::fromArray($request->validated()),
            $request->header('If-Match'),
        );

        return $this->response($updated);
    }

    public function destroy(Request $request, string $profile): Response
    {
        $model = $this->locator->profileV2(CurrentOrganization::from($request), $profile);
        Gate::authorize('delete', $model);
        $this->authoring->deleteProfileDraft($model, $request->header('If-Match'));

        return response()->noContent();
    }

    private function response(DeviceProfile $profile, int $status = 200): JsonResponse
    {
        $profile->load(['versions' => $this->v2Versions(...)]);

        return DeviceProfileV2Resource::make($profile)
            ->additional(['etag' => $profile->etag()])
            ->response()
            ->setStatusCode($status)
            ->withHeaders(['ETag' => $profile->etag()]);
    }

    private function v2Versions($query): void
    {
        $query
            ->where('contract_version', DefinitionContractVersion::V2->value)
            ->orderByDesc('version');
    }
}
