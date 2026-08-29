<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Http\Controllers;

use App\Domain\Authorization\Support\CurrentOrganization;
use App\Domain\DeviceManagement\Data\GatewayRouteAuthoringData;
use App\Domain\DeviceManagement\Http\Requests\GatewayRouteAuthoringRequest;
use App\Domain\DeviceManagement\Http\Resources\GatewayRouteResource;
use App\Domain\DeviceManagement\Models\GatewayRoute;
use App\Domain\DeviceManagement\Services\GatewayRouteManager;
use App\Domain\DeviceProfile\Services\TenantDeviceDomainLocator;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

final class GatewayRouteController
{
    public function __construct(
        private readonly GatewayRouteManager $routes,
        private readonly TenantDeviceDomainLocator $locator,
    ) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        $organization = CurrentOrganization::from($request);
        Gate::authorize('viewAny', [GatewayRoute::class, $organization]);
        $query = GatewayRoute::query()
            ->whereBelongsTo($organization)
            ->with($this->relations())
            ->orderBy('route_path');

        if ($request->has('enabled')) {
            $query->where('enabled', $request->boolean('enabled'));
        }

        foreach (['gateway_uuid' => 'gateway', 'device_uuid' => 'device'] as $parameter => $relation) {
            if (is_string($request->query($parameter)) && $request->query($parameter) !== '') {
                $uuid = (string) $request->query($parameter);
                $query->whereHas($relation, fn ($related) => $related->where('uuid', $uuid));
            }
        }

        return GatewayRouteResource::collection(
            $query->paginate(max(1, min(100, $request->integer('per_page', 25)))),
        );
    }

    public function store(GatewayRouteAuthoringRequest $request): JsonResponse
    {
        $organization = CurrentOrganization::from($request);
        Gate::authorize('create', [GatewayRoute::class, $organization]);
        $data = GatewayRouteAuthoringData::fromArray($request->validated());
        $gateway = $this->locator->gateway($organization, $data->gatewayUuid);
        $device = $this->locator->device($organization, $data->deviceUuid);
        $profileVersion = $this->locator->profileVersion($organization, $data->profileVersionUuid);
        $bindingVersion = $this->locator->bindingVersion($organization, $data->bindingVersionUuid);
        Gate::authorize('assignDefinition', $device);
        /** @var User $actor */
        $actor = $request->user();
        $route = $this->routes->create(
            $organization,
            $gateway,
            $device,
            $profileVersion,
            $bindingVersion,
            $data,
            $actor,
        );

        return $this->response($route, 201);
    }

    public function show(Request $request, string $route): JsonResponse
    {
        $model = $this->locator->gatewayRoute(CurrentOrganization::from($request), $route);
        Gate::authorize('view', $model);

        return $this->response($model);
    }

    public function update(GatewayRouteAuthoringRequest $request, string $route): JsonResponse
    {
        $organization = CurrentOrganization::from($request);
        $model = $this->locator->gatewayRoute($organization, $route);
        Gate::authorize('update', $model);
        $data = GatewayRouteAuthoringData::fromArray($request->validated());
        $gateway = $this->locator->gateway($organization, $data->gatewayUuid);
        /** @var User $actor */
        $actor = $request->user();
        $updated = $this->routes->replace(
            $model,
            $gateway,
            $data,
            $request->header('If-Match'),
            $actor,
        );

        return $this->response($updated);
    }

    public function destroy(Request $request, string $route): Response
    {
        $model = $this->locator->gatewayRoute(CurrentOrganization::from($request), $route);
        Gate::authorize('delete', $model);
        /** @var User $actor */
        $actor = $request->user();
        $this->routes->delete($model, $request->header('If-Match'), $actor);

        return response()->noContent();
    }

    private function response(GatewayRoute $route, int $status = 200): JsonResponse
    {
        $route->load($this->relations());

        return GatewayRouteResource::make($route)
            ->additional(['etag' => $route->etag()])
            ->response()
            ->setStatusCode($status)
            ->withHeaders(['ETag' => $route->etag()]);
    }

    /** @return list<string> */
    private function relations(): array
    {
        return ['gateway', 'device', 'profileVersion', 'bindingVersion', 'definitionAssignment'];
    }
}
