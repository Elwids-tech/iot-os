<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Data;

use App\Domain\DeviceProfile\Support\DeviceDomainV2Payload;
use App\Domain\Shared\Data\AuthoringPayload;
use Illuminate\Contracts\Support\Arrayable;
use InvalidArgumentException;
use JsonSerializable;

/** @implements Arrayable<string, mixed> */
final readonly class GatewayAuthoringData implements Arrayable, JsonSerializable
{
    private function __construct(
        public string $uuid,
        public string $key,
        public string $name,
        public ?string $description,
        public string $mqttClientId,
    ) {}

    /** @param array<string, mixed> $payload */
    public static function fromArray(array $payload): self
    {
        AuthoringPayload::assertAllowedKeys($payload, ['schema', 'gateway'], 'Gateway document');

        if (($payload['schema'] ?? null) !== 'iot.gateway.authoring.v2') {
            throw new InvalidArgumentException('Unsupported Gateway authoring schema.');
        }

        $gateway = AuthoringPayload::object($payload['gateway'] ?? null, 'gateway');
        AuthoringPayload::assertAllowedKeys(
            $gateway,
            ['uuid', 'key', 'name', 'description', 'mqtt_client_id'],
            'gateway',
        );

        $mqttClientId = DeviceDomainV2Payload::boundedString(
            $gateway['mqtt_client_id'] ?? null,
            'gateway.mqtt_client_id',
            256,
        );

        if (preg_match('/[+#\x00]/', $mqttClientId) === 1) {
            throw new InvalidArgumentException('gateway.mqtt_client_id cannot contain MQTT wildcards or null bytes.');
        }

        return new self(
            AuthoringPayload::uuid($gateway['uuid'] ?? null, 'gateway.uuid'),
            AuthoringPayload::key($gateway['key'] ?? null, 'gateway.key'),
            DeviceDomainV2Payload::boundedString($gateway['name'] ?? null, 'gateway.name', 160),
            DeviceDomainV2Payload::nullableBoundedString(
                $gateway['description'] ?? null,
                'gateway.description',
                4000,
            ),
            $mqttClientId,
        );
    }

    /** @return array<string, mixed> */
    public function attributes(): array
    {
        return [
            'uuid' => $this->uuid,
            'key' => $this->key,
            'name' => $this->name,
            'description' => $this->description,
            'mqtt_client_id' => $this->mqttClientId,
        ];
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'schema' => 'iot.gateway.authoring.v2',
            'gateway' => $this->attributes(),
        ];
    }

    /** @return array<string, mixed> */
    public function jsonSerialize(): array
    {
        return $this->toArray();
    }
}
