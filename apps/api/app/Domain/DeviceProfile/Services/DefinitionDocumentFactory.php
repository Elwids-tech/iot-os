<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Services;

use App\Domain\DeviceManagement\Data\GatewayAuthoringData;
use App\Domain\DeviceManagement\Data\GatewayRouteAuthoringData;
use App\Domain\DeviceManagement\Models\Gateway;
use App\Domain\DeviceManagement\Models\GatewayRoute;
use App\Domain\DeviceProfile\Data\DeviceProfileAuthoringData;
use App\Domain\DeviceProfile\Data\NativeMqttBindingAuthoringData;
use App\Domain\DeviceProfile\Models\DeviceProfile;
use App\Domain\DeviceProfile\Models\DeviceProfileVersion;
use App\Domain\DeviceProfile\Models\TransportBinding;
use App\Domain\DeviceProfile\Models\TransportBindingVersion;

final class DefinitionDocumentFactory
{
    public function profile(
        DeviceProfile $profile,
        DeviceProfileVersion $version,
    ): DeviceProfileAuthoringData {
        return DeviceProfileAuthoringData::fromArray([
            'schema' => 'iot.device-profile.authoring.v1',
            'profile' => [
                'uuid' => $profile->uuid,
                'key' => $profile->key,
                'name' => $profile->name,
                'description' => $profile->description,
            ],
            'version' => $version->definition,
        ]);
    }

    public function binding(
        TransportBinding $binding,
        TransportBindingVersion $version,
    ): NativeMqttBindingAuthoringData {
        $profile = $binding->profile()->firstOrFail();

        return NativeMqttBindingAuthoringData::fromArray([
            'schema' => 'iot.native-mqtt-binding.authoring.v1',
            'binding' => [
                'uuid' => $binding->uuid,
                'profile_uuid' => $profile->uuid,
                'key' => $binding->key,
                'name' => $binding->name,
                'description' => $binding->description,
                'transport' => $binding->transport,
            ],
            'version' => $version->definition,
        ]);
    }

    public function gateway(Gateway $gateway): GatewayAuthoringData
    {
        return GatewayAuthoringData::fromArray([
            'schema' => 'iot.gateway.authoring.v1',
            'gateway' => [
                'uuid' => $gateway->uuid,
                'key' => $gateway->key,
                'name' => $gateway->name,
                'description' => $gateway->description,
                'mqtt_client_id' => $gateway->mqtt_client_id,
            ],
        ]);
    }

    public function route(GatewayRoute $route): GatewayRouteAuthoringData
    {
        $gateway = $route->gateway()->firstOrFail();
        $device = $route->device()->firstOrFail();
        $profileVersion = $route->profileVersion()->firstOrFail();
        $bindingVersion = $route->bindingVersion()->firstOrFail();

        return GatewayRouteAuthoringData::fromArray([
            'schema' => 'iot.gateway-route.authoring.v1',
            'route' => [
                'uuid' => $route->uuid,
                'revision' => $route->revision,
                'gateway_uuid' => $gateway->uuid,
                'device_uuid' => $device->uuid,
                'profile_version_uuid' => $profileVersion->uuid,
                'binding_version_uuid' => $bindingVersion->uuid,
                'route_path' => $route->route_path,
                'topic_variables' => $route->topic_variables ?? [],
                'inbound_scopes' => $route->inbound_scopes,
                'enabled' => $route->enabled,
            ],
        ]);
    }
}
