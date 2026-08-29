<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Data;

use App\Domain\DeviceProfile\Support\DeviceDomainJsonShape;
use App\Domain\DeviceProfile\Support\DeviceDomainPayload;
use App\Domain\Shared\Data\AuthoringPayload;
use Illuminate\Contracts\Support\Arrayable;
use InvalidArgumentException;
use JsonSerializable;

/** @implements Arrayable<string, mixed> */
final readonly class NativeMqttBindingAuthoringData implements Arrayable, JsonSerializable
{
    /**
     * @param  array<string, mixed>  $binding
     * @param  array<string, mixed>  $version
     */
    private function __construct(
        public array $binding,
        public array $version,
    ) {}

    /** @param array<string, mixed> $payload */
    public static function fromArray(array $payload): self
    {
        AuthoringPayload::assertAllowedKeys($payload, ['schema', 'binding', 'version'], 'Native MQTT Binding document');

        if (($payload['schema'] ?? null) !== 'iot.native-mqtt-binding.authoring.v1') {
            throw new InvalidArgumentException('Unsupported Native MQTT Binding authoring schema.');
        }

        $binding = AuthoringPayload::object($payload['binding'] ?? null, 'binding');
        AuthoringPayload::assertAllowedKeys(
            $binding,
            ['uuid', 'profile_uuid', 'key', 'name', 'description', 'transport'],
            'binding',
        );
        AuthoringPayload::uuid($binding['uuid'] ?? null, 'binding.uuid');
        AuthoringPayload::uuid($binding['profile_uuid'] ?? null, 'binding.profile_uuid');
        AuthoringPayload::key($binding['key'] ?? null, 'binding.key');
        DeviceDomainPayload::boundedString($binding['name'] ?? null, 'binding.name', 160);
        DeviceDomainPayload::nullableBoundedString($binding['description'] ?? null, 'binding.description', 4000);

        if (($binding['transport'] ?? null) !== 'native_mqtt_json') {
            throw new InvalidArgumentException('binding.transport must be native_mqtt_json.');
        }

        $version = AuthoringPayload::object($payload['version'] ?? null, 'version');
        AuthoringPayload::assertAllowedKeys($version, [
            'uuid',
            'profile_version_uuid',
            'version',
            'notes',
            'channels',
            'parameter_mappings',
            'property_mappings',
            'event_mappings',
            'command_mappings',
        ], 'version');
        AuthoringPayload::uuid($version['uuid'] ?? null, 'version.uuid');
        AuthoringPayload::uuid($version['profile_version_uuid'] ?? null, 'version.profile_version_uuid');
        AuthoringPayload::positiveInteger($version['version'] ?? null, 'version.version');
        DeviceDomainPayload::nullableBoundedString($version['notes'] ?? null, 'version.notes', 4000);
        self::validateVersion($version);

        return new self($binding, DeviceDomainJsonShape::bindingVersion($version));
    }

    public function bindingUuid(): string
    {
        return strtolower((string) $this->binding['uuid']);
    }

    public function profileUuid(): string
    {
        return strtolower((string) $this->binding['profile_uuid']);
    }

    public function bindingKey(): string
    {
        return (string) $this->binding['key'];
    }

    public function bindingName(): string
    {
        return (string) $this->binding['name'];
    }

    public function bindingDescription(): ?string
    {
        return $this->binding['description'] ?? null;
    }

    public function versionUuid(): string
    {
        return strtolower((string) $this->version['uuid']);
    }

    public function profileVersionUuid(): string
    {
        return strtolower((string) $this->version['profile_version_uuid']);
    }

    public function versionNumber(): int
    {
        return (int) $this->version['version'];
    }

    /** @return array<string, mixed> */
    public function versionDefinition(): array
    {
        return $this->version;
    }

    /** @return list<string> */
    public function targetParameterUuids(): array
    {
        return self::targetUuids($this->version['parameter_mappings'], 'target_parameter_uuid');
    }

    /** @return list<string> */
    public function targetPropertyUuids(): array
    {
        return self::targetUuids($this->version['property_mappings'], 'target_property_uuid');
    }

    /** @return list<string> */
    public function targetEventUuids(): array
    {
        return self::targetUuids($this->version['event_mappings'], 'target_event_uuid');
    }

    /** @return list<string> */
    public function targetCommandUuids(): array
    {
        return self::targetUuids($this->version['command_mappings'], 'target_command_uuid');
    }

    /** @return list<string> */
    public function targetEventFieldUuids(): array
    {
        $targets = [];

        foreach ($this->version['event_mappings'] as $mapping) {
            foreach ($mapping['field_mappings'] as $field) {
                $targets[] = strtolower((string) $field['target_event_field_uuid']);
            }
        }

        return array_values(array_unique($targets));
    }

    /** @return list<string> */
    public function targetCommandFieldUuids(): array
    {
        $targets = [];

        foreach ($this->version['command_mappings'] as $mapping) {
            foreach ($mapping['field_mappings'] as $field) {
                $targets[] = strtolower((string) $field['target_command_field_uuid']);
            }
        }

        return array_values(array_unique($targets));
    }

    /** @return array<string, array<string, mixed>> */
    public function channelsByKey(): array
    {
        $channels = [];

        foreach ($this->version['channels'] as $channel) {
            $channels[(string) $channel['key']] = $channel;
        }

        return $channels;
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'schema' => 'iot.native-mqtt-binding.authoring.v1',
            'binding' => $this->binding,
            'version' => $this->version,
        ];
    }

    /** @return array<string, mixed> */
    public function jsonSerialize(): array
    {
        return $this->toArray();
    }

    /** @param array<string, mixed> $version */
    private static function validateVersion(array $version): void
    {
        $channels = AuthoringPayload::list($version['channels'] ?? null, 'version.channels');
        $parameterMappings = AuthoringPayload::list(
            $version['parameter_mappings'] ?? null,
            'version.parameter_mappings',
        );
        $propertyMappings = AuthoringPayload::list(
            $version['property_mappings'] ?? null,
            'version.property_mappings',
        );
        $eventMappings = AuthoringPayload::list($version['event_mappings'] ?? null, 'version.event_mappings');
        $commandMappings = AuthoringPayload::list(
            $version['command_mappings'] ?? null,
            'version.command_mappings',
        );

        if ($channels === []) {
            throw new InvalidArgumentException('version.channels must contain at least one channel.');
        }

        DeviceDomainPayload::assertMaximumItems($channels, 32, 'version.channels');
        DeviceDomainPayload::assertMaximumItems($parameterMappings, 1024, 'version.parameter_mappings');
        DeviceDomainPayload::assertMaximumItems($propertyMappings, 1024, 'version.property_mappings');
        DeviceDomainPayload::assertMaximumItems($eventMappings, 256, 'version.event_mappings');
        DeviceDomainPayload::assertMaximumItems($commandMappings, 256, 'version.command_mappings');

        $channelKeys = [];
        $seenUuids = [];

        foreach ($channels as $index => $value) {
            $path = "version.channels.{$index}";
            $channel = AuthoringPayload::object($value, $path);
            AuthoringPayload::assertAllowedKeys($channel, [
                'uuid',
                'key',
                'label',
                'purpose',
                'direction',
                'topic_template',
                'qos',
                'retain',
                'content_type',
                'record_path',
                'max_records',
                'envelope',
            ], $path);
            $uuid = AuthoringPayload::uuid($channel['uuid'] ?? null, "{$path}.uuid");
            $key = AuthoringPayload::key($channel['key'] ?? null, "{$path}.key");

            if (isset($seenUuids[$uuid]) || isset($channelKeys[$key])) {
                throw new InvalidArgumentException("{$path} duplicates a Channel UUID or key.");
            }

            $seenUuids[$uuid] = true;
            $channelKeys[$key] = true;
            DeviceDomainPayload::boundedString($channel['label'] ?? null, "{$path}.label", 160);
            DeviceDomainPayload::enum(
                $channel['purpose'] ?? null,
                DeviceDomainPayload::BINDING_PURPOSES,
                "{$path}.purpose",
            );
            DeviceDomainPayload::enum(
                $channel['direction'] ?? null,
                DeviceDomainPayload::BINDING_DIRECTIONS,
                "{$path}.direction",
            );
            DeviceDomainPayload::topicTemplate($channel['topic_template'] ?? null, "{$path}.topic_template");
            DeviceDomainPayload::integerBetween($channel['qos'] ?? null, 0, 1, "{$path}.qos");
            AuthoringPayload::boolean($channel['retain'] ?? null, "{$path}.retain");

            if (($channel['content_type'] ?? null) !== 'application/json') {
                throw new InvalidArgumentException("{$path}.content_type must be application/json.");
            }

            DeviceDomainPayload::recordPath($channel['record_path'] ?? null, "{$path}.record_path");
            DeviceDomainPayload::integerBetween(
                $channel['max_records'] ?? null,
                1,
                100,
                "{$path}.max_records",
            );
            self::validateEnvelope($channel['envelope'] ?? null, "{$path}.envelope");
        }

        self::validateValueMappings(
            $parameterMappings,
            'parameter',
            $channelKeys,
            $seenUuids,
        );
        self::validateValueMappings(
            $propertyMappings,
            'property',
            $channelKeys,
            $seenUuids,
        );
        self::validateEventMappings($eventMappings, $channelKeys, $seenUuids);
        self::validateCommandMappings($commandMappings, $channelKeys, $seenUuids);
    }

    private static function validateEnvelope(mixed $value, string $path): void
    {
        $envelope = AuthoringPayload::object($value, $path);
        AuthoringPayload::assertAllowedKeys($envelope, ['observed_at', 'message_id', 'sequence'], $path);

        if (array_key_exists('observed_at', $envelope)) {
            $timestamp = AuthoringPayload::object($envelope['observed_at'], "{$path}.observed_at");
            AuthoringPayload::assertAllowedKeys($timestamp, ['path', 'format'], "{$path}.observed_at");
            DeviceDomainPayload::pathReference($timestamp['path'] ?? null, "{$path}.observed_at.path");
            DeviceDomainPayload::enum(
                $timestamp['format'] ?? null,
                ['rfc3339', 'unix_seconds', 'unix_milliseconds'],
                "{$path}.observed_at.format",
            );
        }

        foreach (['message_id', 'sequence'] as $field) {
            if (array_key_exists($field, $envelope)) {
                DeviceDomainPayload::pathReference($envelope[$field], "{$path}.{$field}");
            }
        }
    }

    /**
     * @param  list<mixed>  $mappings
     * @param  array<string, bool>  $channelKeys
     * @param  array<string, bool>  $seenUuids
     */
    private static function validateValueMappings(
        array $mappings,
        string $kind,
        array $channelKeys,
        array &$seenUuids,
    ): void {
        $targetField = $kind === 'parameter' ? 'target_parameter_uuid' : 'target_property_uuid';
        $operationsField = $kind === 'parameter' ? 'calibration' : 'operations';
        $allowed = $kind === 'parameter'
            ? ['uuid', 'channel', $targetField, 'source', 'wire_data_type', $operationsField, 'on_missing', 'on_invalid', 'default_value']
            : ['uuid', 'channel', $targetField, 'direction', 'source', 'wire_data_type', $operationsField, 'on_missing', 'on_invalid', 'default_value'];

        foreach ($mappings as $index => $value) {
            $path = "version.{$kind}_mappings.{$index}";
            $mapping = AuthoringPayload::object($value, $path);
            AuthoringPayload::assertAllowedKeys($mapping, $allowed, $path);
            self::mappingUuid($mapping, $path, $seenUuids);
            self::knownChannel($mapping['channel'] ?? null, "{$path}.channel", $channelKeys);
            AuthoringPayload::uuid($mapping[$targetField] ?? null, "{$path}.{$targetField}");

            if ($kind === 'property') {
                DeviceDomainPayload::enum(
                    $mapping['direction'] ?? null,
                    DeviceDomainPayload::BINDING_DIRECTIONS,
                    "{$path}.direction",
                );
            }

            DeviceDomainPayload::pathReference($mapping['source'] ?? null, "{$path}.source");
            DeviceDomainPayload::enum(
                $mapping['wire_data_type'] ?? null,
                DeviceDomainPayload::DATA_TYPES,
                "{$path}.wire_data_type",
            );
            DeviceDomainPayload::calibrationPipeline(
                $mapping[$operationsField] ?? null,
                "{$path}.{$operationsField}",
            );
            DeviceDomainPayload::mappingPolicies($mapping, $path);
        }
    }

    /**
     * @param  list<mixed>  $mappings
     * @param  array<string, bool>  $channelKeys
     * @param  array<string, bool>  $seenUuids
     */
    private static function validateEventMappings(array $mappings, array $channelKeys, array &$seenUuids): void
    {
        foreach ($mappings as $index => $value) {
            $path = "version.event_mappings.{$index}";
            $mapping = AuthoringPayload::object($value, $path);
            AuthoringPayload::assertAllowedKeys(
                $mapping,
                ['uuid', 'channel', 'target_event_uuid', 'discriminator', 'event_id', 'state', 'field_mappings'],
                $path,
            );
            self::mappingUuid($mapping, $path, $seenUuids);
            self::knownChannel($mapping['channel'] ?? null, "{$path}.channel", $channelKeys);
            AuthoringPayload::uuid($mapping['target_event_uuid'] ?? null, "{$path}.target_event_uuid");

            if (array_key_exists('discriminator', $mapping)) {
                $discriminator = AuthoringPayload::object($mapping['discriminator'], "{$path}.discriminator");
                AuthoringPayload::assertAllowedKeys(
                    $discriminator,
                    ['source', 'equals'],
                    "{$path}.discriminator",
                );

                if (! array_key_exists('equals', $discriminator)) {
                    throw new InvalidArgumentException("{$path}.discriminator.equals is required.");
                }

                DeviceDomainPayload::pathReference(
                    $discriminator['source'] ?? null,
                    "{$path}.discriminator.source",
                );
                DeviceDomainPayload::jsonScalar(
                    $discriminator['equals'] ?? null,
                    "{$path}.discriminator.equals",
                );
            }

            if (array_key_exists('event_id', $mapping)) {
                DeviceDomainPayload::pathReference($mapping['event_id'], "{$path}.event_id");
            }

            if (array_key_exists('state', $mapping)) {
                self::validateEventState($mapping['state'], "{$path}.state");
            }

            $fieldMappings = AuthoringPayload::list($mapping['field_mappings'] ?? null, "{$path}.field_mappings");
            DeviceDomainPayload::assertMaximumItems($fieldMappings, 64, "{$path}.field_mappings");

            foreach ($fieldMappings as $fieldIndex => $fieldValue) {
                $fieldPath = "{$path}.field_mappings.{$fieldIndex}";
                $field = AuthoringPayload::object($fieldValue, $fieldPath);
                AuthoringPayload::assertAllowedKeys(
                    $field,
                    [
                        'target_event_field_uuid',
                        'source',
                        'wire_data_type',
                        'operations',
                        'on_missing',
                        'on_invalid',
                        'default_value',
                    ],
                    $fieldPath,
                );
                AuthoringPayload::uuid(
                    $field['target_event_field_uuid'] ?? null,
                    "{$fieldPath}.target_event_field_uuid",
                );
                self::validateExtractedValue($field, $fieldPath, 'source', 'operations');
            }
        }
    }

    private static function validateEventState(mixed $value, string $path): void
    {
        $state = AuthoringPayload::object($value, $path);
        AuthoringPayload::assertAllowedKeys($state, ['source', 'active_values', 'cleared_values'], $path);
        DeviceDomainPayload::pathReference($state['source'] ?? null, "{$path}.source");
        $active = DeviceDomainPayload::statusValues(
            $state['active_values'] ?? null,
            "{$path}.active_values",
        );
        $cleared = DeviceDomainPayload::statusValues(
            $state['cleared_values'] ?? null,
            "{$path}.cleared_values",
        );
        DeviceDomainPayload::assertDisjointStatusGroups([
            'active_values' => $active,
            'cleared_values' => $cleared,
        ], $path);
    }

    /**
     * @param  list<mixed>  $mappings
     * @param  array<string, bool>  $channelKeys
     * @param  array<string, bool>  $seenUuids
     */
    private static function validateCommandMappings(array $mappings, array $channelKeys, array &$seenUuids): void
    {
        foreach ($mappings as $index => $value) {
            $path = "version.command_mappings.{$index}";
            $mapping = AuthoringPayload::object($value, $path);
            AuthoringPayload::assertAllowedKeys($mapping, [
                'uuid',
                'target_command_uuid',
                'request_channel',
                'response_channel',
                'request_template',
                'request_envelope',
                'response',
                'field_mappings',
            ], $path);
            self::mappingUuid($mapping, $path, $seenUuids);
            AuthoringPayload::uuid($mapping['target_command_uuid'] ?? null, "{$path}.target_command_uuid");
            self::knownChannel($mapping['request_channel'] ?? null, "{$path}.request_channel", $channelKeys);

            if (array_key_exists('response_channel', $mapping) && $mapping['response_channel'] !== null) {
                self::knownChannel($mapping['response_channel'], "{$path}.response_channel", $channelKeys);
            }

            AuthoringPayload::object($mapping['request_template'] ?? null, "{$path}.request_template");
            self::validateRequestEnvelope($mapping['request_envelope'] ?? null, "{$path}.request_envelope");

            if (array_key_exists('response', $mapping)) {
                self::validateCommandResponse($mapping['response'], "{$path}.response");
            }

            $fieldMappings = AuthoringPayload::list($mapping['field_mappings'] ?? null, "{$path}.field_mappings");
            DeviceDomainPayload::assertMaximumItems($fieldMappings, 64, "{$path}.field_mappings");

            foreach ($fieldMappings as $fieldIndex => $fieldValue) {
                $fieldPath = "{$path}.field_mappings.{$fieldIndex}";
                $field = AuthoringPayload::object($fieldValue, $fieldPath);
                AuthoringPayload::assertAllowedKeys(
                    $field,
                    [
                        'direction',
                        'target_command_field_uuid',
                        'json_path',
                        'wire_data_type',
                        'operations',
                        'on_missing',
                        'on_invalid',
                        'default_value',
                    ],
                    $fieldPath,
                );
                DeviceDomainPayload::enum(
                    $field['direction'] ?? null,
                    DeviceDomainPayload::COMMAND_FIELD_DIRECTIONS,
                    "{$fieldPath}.direction",
                );
                AuthoringPayload::uuid(
                    $field['target_command_field_uuid'] ?? null,
                    "{$fieldPath}.target_command_field_uuid",
                );
                DeviceDomainPayload::jsonPath($field['json_path'] ?? null, "{$fieldPath}.json_path");
                DeviceDomainPayload::enum(
                    $field['wire_data_type'] ?? null,
                    DeviceDomainPayload::DATA_TYPES,
                    "{$fieldPath}.wire_data_type",
                );
                DeviceDomainPayload::calibrationPipeline(
                    $field['operations'] ?? null,
                    "{$fieldPath}.operations",
                );
                DeviceDomainPayload::mappingPolicies($field, $fieldPath);
            }
        }
    }

    private static function validateRequestEnvelope(mixed $value, string $path): void
    {
        $envelope = AuthoringPayload::object($value, $path);
        AuthoringPayload::assertAllowedKeys($envelope, [
            'command_id_path',
            'requested_at_path',
            'expires_at_path',
            'route_path_path',
            'route_variable_paths',
        ], $path);
        DeviceDomainPayload::jsonPath($envelope['command_id_path'] ?? null, "{$path}.command_id_path");

        foreach (['requested_at_path', 'expires_at_path', 'route_path_path'] as $field) {
            if (array_key_exists($field, $envelope)) {
                DeviceDomainPayload::jsonPath($envelope[$field], "{$path}.{$field}");
            }
        }

        if (array_key_exists('route_variable_paths', $envelope)) {
            $paths = AuthoringPayload::object($envelope['route_variable_paths'], "{$path}.route_variable_paths");

            if (count($paths) > 32) {
                throw new InvalidArgumentException("{$path}.route_variable_paths cannot contain more than 32 paths.");
            }

            foreach ($paths as $key => $jsonPath) {
                AuthoringPayload::key($key, "{$path}.route_variable_paths.{$key}");
                DeviceDomainPayload::jsonPath($jsonPath, "{$path}.route_variable_paths.{$key}");
            }
        }
    }

    private static function validateCommandResponse(mixed $value, string $path): void
    {
        $response = AuthoringPayload::object($value, $path);
        AuthoringPayload::assertAllowedKeys($response, ['correlation', 'status'], $path);
        DeviceDomainPayload::pathReference($response['correlation'] ?? null, "{$path}.correlation");

        $status = AuthoringPayload::object($response['status'] ?? null, "{$path}.status");
        AuthoringPayload::assertAllowedKeys($status, ['path', 'values'], "{$path}.status");
        DeviceDomainPayload::pathReference($status['path'] ?? null, "{$path}.status.path");

        $values = AuthoringPayload::object($status['values'] ?? null, "{$path}.status.values");
        AuthoringPayload::assertAllowedKeys(
            $values,
            ['accepted', 'running', 'succeeded', 'failed'],
            "{$path}.status.values",
        );

        $statusGroups = [];

        foreach (['succeeded', 'failed'] as $required) {
            $statusGroups[$required] = DeviceDomainPayload::statusValues(
                $values[$required] ?? null,
                "{$path}.status.values.{$required}",
            );
        }

        foreach (['accepted', 'running'] as $optional) {
            if (array_key_exists($optional, $values)) {
                $statusGroups[$optional] = DeviceDomainPayload::statusValues(
                    $values[$optional],
                    "{$path}.status.values.{$optional}",
                );
            }
        }

        DeviceDomainPayload::assertDisjointStatusGroups($statusGroups, "{$path}.status.values");
    }

    /** @param array<string, mixed> $field */
    private static function validateExtractedValue(
        array $field,
        string $path,
        string $sourceField,
        string $operationsField,
    ): void {
        DeviceDomainPayload::pathReference($field[$sourceField] ?? null, "{$path}.{$sourceField}");
        DeviceDomainPayload::enum(
            $field['wire_data_type'] ?? null,
            DeviceDomainPayload::DATA_TYPES,
            "{$path}.wire_data_type",
        );
        DeviceDomainPayload::calibrationPipeline(
            $field[$operationsField] ?? null,
            "{$path}.{$operationsField}",
        );
        DeviceDomainPayload::mappingPolicies($field, $path);
    }

    /** @param array<string, mixed> $mapping @param array<string, bool> $seenUuids */
    private static function mappingUuid(array $mapping, string $path, array &$seenUuids): void
    {
        $uuid = AuthoringPayload::uuid($mapping['uuid'] ?? null, "{$path}.uuid");

        if (isset($seenUuids[$uuid])) {
            throw new InvalidArgumentException("{$path}.uuid duplicates {$uuid}.");
        }

        $seenUuids[$uuid] = true;
    }

    /** @param array<string, bool> $channelKeys */
    private static function knownChannel(mixed $value, string $path, array $channelKeys): string
    {
        $channel = AuthoringPayload::key($value, $path);

        if (! isset($channelKeys[$channel])) {
            throw new InvalidArgumentException("{$path} references unknown Channel {$channel}.");
        }

        return $channel;
    }

    /** @param list<array<string, mixed>> $mappings @return list<string> */
    private static function targetUuids(array $mappings, string $field): array
    {
        return array_values(array_map(
            static fn (array $mapping): string => strtolower((string) $mapping[$field]),
            $mappings,
        ));
    }
}
