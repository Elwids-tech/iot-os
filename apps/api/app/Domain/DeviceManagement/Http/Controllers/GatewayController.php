<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Http\Controllers;

use App\Domain\Authorization\Support\CurrentOrganization;
use App\Domain\DeviceManagement\Data\GatewayAuthoringData;
use App\Domain\DeviceManagement\Http\Requests\GatewayAuthoringRequest;
use App\Domain\DeviceManagement\Http\Resources\GatewayResource;
use App\Domain\DeviceManagement\Models\Gateway;
use App\Domain\DeviceManagement\Services\GatewayManager;
use App\Domain\DeviceProfile\Services\TenantDeviceDomainLocator;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

final class GatewayController
{
    public function __construct(
        private readonly GatewayManager $gateways,
        private readonly TenantDeviceDomainLocator $locator,
    ) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        $organization = CurrentOrganization::from($request);
        Gate::authorize('viewAny', [Gateway::class, $organization]);
        $query = Gateway::query()
            ->whereBelongsTo($organization)
            ->withCount('routes')
            ->orderBy('name');

        if (is_string($request->query('search')) && $request->query('search') !== '') {
            $search = '%'.str_replace(['%', '_'], ['\%', '\_'], (string) $request->query('search')).'%';
            $query->where(static fn ($builder) => $builder
                ->where('name', 'like', $search)
                ->orWhere('key', 'like', $search)
                ->orWhere('mqtt_client_id', 'like', $search));
        }

        return GatewayResource::collection(
            $query->paginate(max(1, min(100, $request->integer('per_page', 25)))),
        );
    }

    public function store(GatewayAuthoringRequest $request): JsonResponse
    {
        $organization = CurrentOrganization::from($request);
        Gate::authorize('create', [Gateway::class, $organization]);
        /** @var User $actor */
        $actor = $request->user();
        $gateway = $this->gateways->create(
            $organization,
            GatewayAuthoringData::fromArray($request->validated()),
            $actor,
        );

        return $this->response($gateway, 201);
    }

    public function show(Request $request, string $gateway): JsonResponse
    {
        $model = $this->locator->gateway(CurrentOrganization::from($request), $gateway);
        Gate::authorize('view', $model);

        return $this->response($model);
    }

    public function update(GatewayAuthoringRequest $request, string $gateway): JsonResponse
    {
        $model = $this->locator->gateway(CurrentOrganization::from($request), $gateway);
        Gate::authorize('update', $model);
        /** @var User $actor */
        $actor = $request->user();
        $updated = $this->gateways->replace(
            $model,
            GatewayAuthoringData::fromArray($request->validated()),
            $request->header('If-Match'),
            $actor,
        );

        return $this->response($updated);
    }

    public function destroy(Request $request, string $gateway): Response
    {
        $model = $this->locator->gateway(CurrentOrganization::from($request), $gateway);
        Gate::authorize('delete', $model);
        $this->gateways->delete($model, $request->header('If-Match'));

        return response()->noContent();
    }

    private function response(Gateway $gateway, int $status = 200): JsonResponse
    {
        $gateway->loadCount('routes');

        return GatewayResource::make($gateway)
            ->additional(['etag' => $gateway->etag()])
            ->response()
            ->setStatusCode($status)
            ->withHeaders(['ETag' => $gateway->etag()]);
    }
}
