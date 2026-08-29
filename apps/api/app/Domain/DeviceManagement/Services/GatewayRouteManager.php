<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Services;

use App\Domain\DeviceManagement\Data\GatewayRouteAuthoringData;
use App\Domain\DeviceManagement\Enums\AssignmentCompatibilityState;
use App\Domain\DeviceManagement\Enums\DeviceIdentityModel;
use App\Domain\DeviceManagement\Models\Device;
use App\Domain\DeviceManagement\Models\DeviceDefinitionAssignment;
use App\Domain\DeviceManagement\Models\Gateway;
use App\Domain\DeviceManagement\Models\GatewayRoute;
use App\Domain\DeviceProfile\Models\DeviceProfileVersion;
use App\Domain\DeviceProfile\Models\TransportBindingVersion;
use App\Domain\Shared\Exceptions\DomainInvariantViolation;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;

final class GatewayRouteManager
{
    public function create(
        Organization $organization,
        Gateway $gateway,
        Device $device,
        DeviceProfileVersion $profileVersion,
        TransportBindingVersion $bindingVersion,
        GatewayRouteAuthoringData $data,
        ?User $actor = null,
    ): GatewayRoute {
        if ($data->revision !== 1) {
            throw new DomainInvariantViolation('A new Gateway Route must start at revision 1.');
        }

        return DB::transaction(function () use (
            $organization,
            $gateway,
            $device,
            $profileVersion,
            $bindingVersion,
            $data,
            $actor,
        ): GatewayRoute {
            $lockedDevice = Device::query()->lockForUpdate()->findOrFail($device->getKey());
            $assignment = $lockedDevice->definitionAssignment()->lockForUpdate()->first();
            $lockedProfileVersion = DeviceProfileVersion::query()->lockForUpdate()->findOrFail($profileVersion->getKey());
            $lockedBindingVersion = TransportBindingVersion::query()->lockForUpdate()->findOrFail($bindingVersion->getKey());
            $lockedGateway = Gateway::query()->lockForUpdate()->findOrFail($gateway->getKey());

            $this->assertRouteIdentityAvailable($organization, $lockedGateway, $data);
            $this->assertRouteCompatibility(
                $organization,
                $lockedGateway,
                $lockedDevice,
                $lockedProfileVersion,
                $lockedBindingVersion,
                $data,
                $assignment,
            );

            if ($assignment->gateway_route_id !== null) {
                throw new DomainInvariantViolation('The Device definition assignment already has a Gateway Route.');
            }

            $route = GatewayRoute::query()->create([
                'organization_id' => $organization->getKey(),
                'gateway_id' => $lockedGateway->getKey(),
                'device_id' => $lockedDevice->getKey(),
                'device_profile_version_id' => $lockedProfileVersion->getKey(),
                'transport_binding_version_id' => $lockedBindingVersion->getKey(),
                ...$data->attributes(),
                'created_by_id' => $actor?->getKey(),
                'updated_by_id' => $actor?->getKey(),
            ]);

            $this->attachAssignment(
                $lockedDevice,
                $assignment,
                $route,
                $lockedProfileVersion,
                $lockedBindingVersion,
                $actor,
            );

            return $route;
        });
    }

    public function replace(
        GatewayRoute $route,
        Gateway $gateway,
        GatewayRouteAuthoringData $data,
        ?string $expectedEntityTag,
        ?User $actor = null,
    ): GatewayRoute {
        $route->assertExpectedEntityTag($expectedEntityTag);

        if ($data->uuid !== $route->uuid || $data->revision !== $route->revision) {
            throw new DomainInvariantViolation('A Gateway Route replacement must preserve UUID and current revision.');
        }

        return DB::transaction(function () use ($route, $gateway, $data, $expectedEntityTag, $actor): GatewayRoute {
            $lockedDevice = Device::query()->lockForUpdate()->findOrFail($route->device_id);
            $assignment = $lockedDevice->definitionAssignment()->lockForUpdate()->first();
            $profileVersion = DeviceProfileVersion::query()->lockForUpdate()->findOrFail($route->device_profile_version_id);
            $bindingVersion = TransportBindingVersion::query()->lockForUpdate()->findOrFail($route->transport_binding_version_id);
            $lockedGateway = Gateway::query()->lockForUpdate()->findOrFail($gateway->getKey());
            $lockedRoute = GatewayRoute::query()->lockForUpdate()->findOrFail($route->getKey());
            $lockedRoute->assertExpectedEntityTag($expectedEntityTag);

            if (
                $data->uuid !== $lockedRoute->uuid
                || $data->revision !== $lockedRoute->revision
                || $data->deviceUuid !== $lockedDevice->uuid
                || $data->profileVersionUuid !== $profileVersion->uuid
                || $data->bindingVersionUuid !== $bindingVersion->uuid
                || $data->gatewayUuid !== $lockedGateway->uuid
            ) {
                throw new DomainInvariantViolation('A Gateway Route replacement has incompatible linked identities.');
            }

            $this->assertRouteCompatibility(
                $lockedRoute->organization,
                $lockedGateway,
                $lockedDevice,
                $profileVersion,
                $bindingVersion,
                $data,
                $assignment,
                $lockedRoute,
            );
            $this->assertRouteIdentityAvailable($lockedRoute->organization, $lockedGateway, $data, $lockedRoute);

            $attributes = $data->attributes();
            unset($attributes['uuid']);
            $lockedRoute->forceFill([
                'gateway_id' => $lockedGateway->getKey(),
                ...$attributes,
                'updated_by_id' => $actor?->getKey(),
                'revision' => $lockedRoute->revision + 1,
            ])->save();

            $this->attachAssignment(
                $lockedDevice,
                $assignment,
                $lockedRoute,
                $profileVersion,
                $bindingVersion,
                $actor,
            );

            return $lockedRoute->refresh();
        });
    }

    public function delete(GatewayRoute $route, ?string $expectedEntityTag, ?User $actor = null): void
    {
        $route->assertExpectedEntityTag($expectedEntityTag);

        DB::transaction(function () use ($route, $expectedEntityTag, $actor): void {
            $lockedDevice = Device::query()->lockForUpdate()->findOrFail($route->device_id);
            $assignment = $lockedDevice->definitionAssignment()->lockForUpdate()->first();
            $lockedRoute = GatewayRoute::query()->lockForUpdate()->findOrFail($route->getKey());
            $lockedRoute->assertExpectedEntityTag($expectedEntityTag);

            if (! $lockedDevice->isDraft()) {
                throw new DomainInvariantViolation('A registered or archived Device Gateway Route is immutable.');
            }

            if ($assignment?->runtime_bundle_hash !== null) {
                throw new DomainInvariantViolation('A Gateway Route with a compiled Runtime Bundle cannot be deleted.');
            }

            if ($assignment?->gateway_route_id === $lockedRoute->getKey()) {
                $assignment->forceFill([
                    'gateway_route_id' => null,
                    'compatibility_state' => AssignmentCompatibilityState::V2_ROUTE_PENDING,
                    'profile_artifact_hash' => null,
                    'binding_artifact_hash' => null,
                    'route_source_hash' => null,
                    'runtime_bundle_hash' => null,
                    'runtime_bundle' => null,
                    'runtime_compiled_at' => null,
                    'updated_by_id' => $actor?->getKey(),
                    'revision' => $assignment->revision + 1,
                ])->save();
            }

            $lockedRoute->delete();
        });
    }

    private function assertRouteCompatibility(
        Organization $organization,
        Gateway $gateway,
        Device $device,
        DeviceProfileVersion $profileVersion,
        TransportBindingVersion $bindingVersion,
        GatewayRouteAuthoringData $data,
        ?DeviceDefinitionAssignment $assignment,
        ?GatewayRoute $existingRoute = null,
    ): void {
        if (! $device->isDraft()) {
            throw new DomainInvariantViolation('A registered or archived Device Gateway Route is immutable.');
        }

        if ($assignment === null || $assignment->isLocked()) {
            throw new DomainInvariantViolation('A mutable Device definition assignment is required before routing.');
        }

        $binding = $bindingVersion->binding()->firstOrFail();

        if (
            $organization->getKey() !== $gateway->organization_id
            || $organization->getKey() !== $device->organization_id
            || $organization->getKey() !== $profileVersion->organization_id
            || $organization->getKey() !== $bindingVersion->organization_id
            || $data->gatewayUuid !== $gateway->uuid
            || $data->deviceUuid !== $device->uuid
            || $data->profileVersionUuid !== $profileVersion->uuid
            || $data->bindingVersionUuid !== $bindingVersion->uuid
            || ! $profileVersion->isPublished()
            || ! $bindingVersion->isPublished()
            || ! $profileVersion->usesV2Contract()
            || ! $bindingVersion->usesV2Contract()
            || $bindingVersion->device_profile_version_id !== $profileVersion->getKey()
            || $binding->device_profile_id !== $profileVersion->device_profile_id
            || $assignment->device_profile_version_id !== $profileVersion->getKey()
            || $assignment->transport_binding_version_id !== $bindingVersion->getKey()
            || ($assignment->gateway_route_id !== null && $assignment->gateway_route_id !== $existingRoute?->getKey())
        ) {
            throw new DomainInvariantViolation('A Gateway Route requires coordinated published v2 definitions and the exact same-tenant Device assignment.');
        }

        if ($profileVersion->artifact_hash === null || $bindingVersion->artifact_hash === null) {
            throw new DomainInvariantViolation('A Gateway Route requires compiled Profile and Binding artifact hashes.');
        }

        $this->assertBindingRouteCompatibility($bindingVersion, $data);
    }

    private function assertBindingRouteCompatibility(
        TransportBindingVersion $bindingVersion,
        GatewayRouteAuthoringData $data,
    ): void {
        $channels = [];

        foreach ($bindingVersion->definition['channels'] ?? [] as $channel) {
            $channels[(string) $channel['key']] = $channel;
        }

        foreach ($data->inboundScopes as $scope) {
            $channelKey = (string) $scope['channel'];
            $channel = $channels[$channelKey] ?? null;

            if ($channel === null) {
                throw new DomainInvariantViolation(
                    "Gateway Route inbound scope references unknown Binding Channel {$channelKey}.",
                );
            }

            if ($channel['direction'] !== 'device_to_platform') {
                throw new DomainInvariantViolation(
                    "Gateway Route inbound scope Channel {$channelKey} must be device-to-platform.",
                );
            }
        }

        $availableVariables = [
            'gateway_id' => true,
            'route_path' => true,
            ...array_fill_keys(array_keys($data->topicVariables), true),
        ];

        foreach ($channels as $channel) {
            preg_match_all('/\{([a-z][a-z0-9_]*)\}/', (string) $channel['topic_template'], $matches);

            foreach (array_unique($matches[1] ?? []) as $variable) {
                if (! isset($availableVariables[$variable])) {
                    throw new DomainInvariantViolation(
                        "Gateway Route does not provide topic variable {$variable}.",
                    );
                }
            }
        }
    }

    private function attachAssignment(
        Device $device,
        DeviceDefinitionAssignment $assignment,
        GatewayRoute $route,
        DeviceProfileVersion $profileVersion,
        TransportBindingVersion $bindingVersion,
        ?User $actor,
    ): void {
        $assignment->forceFill([
            'gateway_route_id' => $route->getKey(),
            'compatibility_state' => AssignmentCompatibilityState::V2_ROUTE_AWARE,
            'profile_artifact_hash' => $profileVersion->artifact_hash,
            'binding_artifact_hash' => $bindingVersion->artifact_hash,
            'route_source_hash' => null,
            'runtime_bundle_hash' => null,
            'runtime_bundle' => null,
            'runtime_compiled_at' => null,
            'updated_by_id' => $actor?->getKey(),
            'revision' => $assignment->revision + 1,
        ])->save();

        if ($device->identity_model !== DeviceIdentityModel::LOGICAL_V2) {
            $device->forceFill([
                'identity_model' => DeviceIdentityModel::LOGICAL_V2,
                'revision' => $device->revision + 1,
            ])->save();
        }
    }

    private function assertRouteIdentityAvailable(
        Organization $organization,
        Gateway $gateway,
        GatewayRouteAuthoringData $data,
        ?GatewayRoute $except = null,
    ): void {
        $query = GatewayRoute::query()->where(static function ($query) use ($organization, $gateway, $data): void {
            $query->where('uuid', $data->uuid)
                ->orWhere(static function ($routePath) use ($organization, $gateway, $data): void {
                    $routePath
                        ->where('organization_id', $organization->getKey())
                        ->where('gateway_id', $gateway->getKey())
                        ->where('route_path', $data->routePath);
                });
        });

        if ($except !== null) {
            $query->whereKeyNot($except->getKey());
        }

        if ($query->exists()) {
            throw new DomainInvariantViolation('The Gateway Route UUID and route path must be unique for the Gateway.');
        }
    }
}
