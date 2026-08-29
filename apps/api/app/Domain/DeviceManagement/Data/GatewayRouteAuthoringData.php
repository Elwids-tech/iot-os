<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Data;

use App\Domain\DeviceProfile\Support\DeviceDomainPayload;
use App\Domain\Shared\Data\AuthoringPayload;
use Illuminate\Contracts\Support\Arrayable;
use InvalidArgumentException;
use JsonSerializable;

/** @implements Arrayable<string, mixed> */
final readonly class GatewayRouteAuthoringData implements Arrayable, JsonSerializable
{
    /**
     * @param  array<string, string>  $topicVariables
     * @param  list<array<string, mixed>>  $inboundScopes
     */
    private function __construct(
        public string $uuid,
        public int $revision,
        public string $gatewayUuid,
        public string $deviceUuid,
        public string $profileVersionUuid,
        public string $bindingVersionUuid,
        public string $routePath,
        public array $topicVariables,
        public array $inboundScopes,
        public bool $enabled,
    ) {}

    /** @param array<string, mixed> $payload */
    public static function fromArray(array $payload): self
    {
        AuthoringPayload::assertAllowedKeys($payload, ['schema', 'route'], 'Gateway Route document');

        if (($payload['schema'] ?? null) !== 'iot.gateway-route.authoring.v1') {
            throw new InvalidArgumentException('Unsupported Gateway Route authoring schema.');
        }

        $route = AuthoringPayload::object($payload['route'] ?? null, 'route');
        AuthoringPayload::assertAllowedKeys($route, [
            'uuid',
            'revision',
            'gateway_uuid',
            'device_uuid',
            'profile_version_uuid',
            'binding_version_uuid',
            'route_path',
            'topic_variables',
            'inbound_scopes',
            'enabled',
        ], 'route');

        $routePath = DeviceDomainPayload::boundedString(
            $route['route_path'] ?? null,
            'route.route_path',
            512,
        );

        if (preg_match('/^[A-Za-z0-9][A-Za-z0-9._:\/-]*$/', $routePath) !== 1) {
            throw new InvalidArgumentException('route.route_path is not a valid logical Device route path.');
        }

        $topicVariables = AuthoringPayload::object($route['topic_variables'] ?? null, 'route.topic_variables');

        if (count($topicVariables) > 32) {
            throw new InvalidArgumentException('route.topic_variables cannot contain more than 32 variables.');
        }

        foreach ($topicVariables as $key => $value) {
            AuthoringPayload::key($key, "route.topic_variables.{$key}");
            $topicVariables[$key] = DeviceDomainPayload::boundedString(
                $value,
                "route.topic_variables.{$key}",
                512,
            );
        }

        return new self(
            AuthoringPayload::uuid($route['uuid'] ?? null, 'route.uuid'),
            AuthoringPayload::positiveInteger($route['revision'] ?? null, 'route.revision'),
            AuthoringPayload::uuid($route['gateway_uuid'] ?? null, 'route.gateway_uuid'),
            AuthoringPayload::uuid($route['device_uuid'] ?? null, 'route.device_uuid'),
            AuthoringPayload::uuid($route['profile_version_uuid'] ?? null, 'route.profile_version_uuid'),
            AuthoringPayload::uuid($route['binding_version_uuid'] ?? null, 'route.binding_version_uuid'),
            $routePath,
            $topicVariables,
            self::inboundScopes($route['inbound_scopes'] ?? null),
            AuthoringPayload::boolean($route['enabled'] ?? null, 'route.enabled'),
        );
    }

    /** @return array<string, mixed> */
    public function attributes(): array
    {
        return [
            'uuid' => $this->uuid,
            'revision' => $this->revision,
            'route_path' => $this->routePath,
            'topic_variables' => (object) $this->topicVariables,
            'inbound_scopes' => $this->inboundScopes,
            'enabled' => $this->enabled,
        ];
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'schema' => 'iot.gateway-route.authoring.v1',
            'route' => [
                'uuid' => $this->uuid,
                'revision' => $this->revision,
                'gateway_uuid' => $this->gatewayUuid,
                'device_uuid' => $this->deviceUuid,
                'profile_version_uuid' => $this->profileVersionUuid,
                'binding_version_uuid' => $this->bindingVersionUuid,
                'route_path' => $this->routePath,
                'topic_variables' => (object) $this->topicVariables,
                'inbound_scopes' => $this->inboundScopes,
                'enabled' => $this->enabled,
            ],
        ];
    }

    /** @return array<string, mixed> */
    public function jsonSerialize(): array
    {
        return $this->toArray();
    }

    /** @return list<array<string, mixed>> */
    private static function inboundScopes(mixed $value): array
    {
        $scopes = AuthoringPayload::list($value, 'route.inbound_scopes');
        DeviceDomainPayload::assertMaximumItems($scopes, 32, 'route.inbound_scopes');
        $channels = [];

        foreach ($scopes as $index => $scopeValue) {
            $path = "route.inbound_scopes.{$index}";
            $scope = AuthoringPayload::object($scopeValue, $path);
            AuthoringPayload::assertAllowedKeys($scope, ['channel', 'payload_path', 'selector'], $path);
            $channel = AuthoringPayload::key($scope['channel'] ?? null, "{$path}.channel");

            if (isset($channels[$channel])) {
                throw new InvalidArgumentException("{$path}.channel duplicates Channel {$channel}.");
            }

            $channels[$channel] = true;
            $normalized = [
                'channel' => $channel,
                'payload_path' => DeviceDomainPayload::jsonPath(
                    $scope['payload_path'] ?? null,
                    "{$path}.payload_path",
                ),
            ];

            if (array_key_exists('selector', $scope)) {
                $selector = AuthoringPayload::object($scope['selector'], "{$path}.selector");
                AuthoringPayload::assertAllowedKeys($selector, ['source', 'equals'], "{$path}.selector");

                if (! array_key_exists('equals', $selector)) {
                    throw new InvalidArgumentException("{$path}.selector.equals is required.");
                }

                $normalized['selector'] = [
                    'source' => DeviceDomainPayload::pathReference(
                        $selector['source'] ?? null,
                        "{$path}.selector.source",
                    ),
                    'equals' => $selector['equals'] ?? null,
                ];
                DeviceDomainPayload::jsonScalar(
                    $selector['equals'] ?? null,
                    "{$path}.selector.equals",
                );
            }

            $scopes[$index] = $normalized;
        }

        return $scopes;
    }
}
