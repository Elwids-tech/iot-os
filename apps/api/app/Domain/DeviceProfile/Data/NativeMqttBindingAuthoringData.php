<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Data;

use Illuminate\Contracts\Support\Arrayable;
use InvalidArgumentException;
use JsonSerializable;

/**
 * @implements Arrayable<string, mixed>
 */
final readonly class NativeMqttBindingAuthoringData implements Arrayable, JsonSerializable
{
    /**
     * @param  array{uuid?: string, profile_uuid: string, key: string, name: string, description?: string|null, transport: string}  $binding
     * @param  array{uuid?: string, profile_version_uuid: string, version: int, notes?: string|null, channels: list<array<string, mixed>>, telemetry_mappings: list<array<string, mixed>>, property_mappings: list<array<string, mixed>>, event_mappings: list<array<string, mixed>>, command_mappings: list<array<string, mixed>>}  $version
     */
    private function __construct(
        public array $binding,
        public array $version,
    ) {}

    /**
     * @param  array<string, mixed>  $payload
     */
    public static function fromArray(array $payload): self
    {
        if (($payload['schema'] ?? null) !== 'iot.native-mqtt-binding.authoring.v1') {
            throw new InvalidArgumentException('Unsupported Native MQTT Binding authoring schema.');
        }

        $binding = $payload['binding'] ?? null;
        $version = $payload['version'] ?? null;

        if (
            ! is_array($binding)
            || ! is_string($binding['profile_uuid'] ?? null)
            || ! is_string($binding['key'] ?? null)
            || ! is_string($binding['name'] ?? null)
            || ($binding['transport'] ?? null) !== 'native_mqtt_json'
        ) {
            throw new InvalidArgumentException('Native MQTT Binding metadata is incomplete.');
        }

        $arrayFields = [
            'channels',
            'telemetry_mappings',
            'property_mappings',
            'event_mappings',
            'command_mappings',
        ];

        if (
            ! is_array($version)
            || ! is_string($version['profile_version_uuid'] ?? null)
            || ! is_int($version['version'] ?? null)
        ) {
            throw new InvalidArgumentException('Native MQTT Binding Version is incomplete.');
        }

        foreach ($arrayFields as $field) {
            if (! is_array($version[$field] ?? null)) {
                throw new InvalidArgumentException("Native MQTT Binding Version field [{$field}] must be an array.");
            }
        }

        /** @var array{uuid?: string, profile_uuid: string, key: string, name: string, description?: string|null, transport: string} $binding */
        /** @var array{uuid?: string, profile_version_uuid: string, version: int, notes?: string|null, channels: list<array<string, mixed>>, telemetry_mappings: list<array<string, mixed>>, property_mappings: list<array<string, mixed>>, event_mappings: list<array<string, mixed>>, command_mappings: list<array<string, mixed>>} $version */
        return new self($binding, $version);
    }

    public function bindingUuid(): ?string
    {
        return $this->binding['uuid'] ?? null;
    }

    public function profileUuid(): string
    {
        return $this->binding['profile_uuid'];
    }

    public function bindingKey(): string
    {
        return $this->binding['key'];
    }

    public function bindingName(): string
    {
        return $this->binding['name'];
    }

    public function bindingDescription(): ?string
    {
        return $this->binding['description'] ?? null;
    }

    public function versionUuid(): ?string
    {
        return $this->version['uuid'] ?? null;
    }

    public function profileVersionUuid(): string
    {
        return $this->version['profile_version_uuid'];
    }

    public function versionNumber(): int
    {
        return $this->version['version'];
    }

    /**
     * @return array<string, mixed>
     */
    public function versionDefinition(): array
    {
        return $this->version;
    }

    /**
     * @return array{schema: string, binding: array<string, mixed>, version: array<string, mixed>}
     */
    public function toArray(): array
    {
        return [
            'schema' => 'iot.native-mqtt-binding.authoring.v1',
            'binding' => $this->binding,
            'version' => $this->version,
        ];
    }

    /**
     * @return array{schema: string, binding: array<string, mixed>, version: array<string, mixed>}
     */
    public function jsonSerialize(): array
    {
        return $this->toArray();
    }
}
