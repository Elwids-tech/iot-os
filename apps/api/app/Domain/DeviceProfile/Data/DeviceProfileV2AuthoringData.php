<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Data;

use App\Domain\DeviceProfile\Support\DeviceDomainV2JsonShape;
use App\Domain\DeviceProfile\Support\DeviceDomainV2Payload;
use App\Domain\Shared\Data\AuthoringPayload;
use Illuminate\Contracts\Support\Arrayable;
use InvalidArgumentException;
use JsonSerializable;

/** @implements Arrayable<string, mixed> */
final readonly class DeviceProfileV2AuthoringData implements Arrayable, JsonSerializable
{
    /**
     * @param  array<string, mixed>  $profile
     * @param  array<string, mixed>  $version
     */
    private function __construct(
        public array $profile,
        public array $version,
    ) {}

    /** @param array<string, mixed> $payload */
    public static function fromArray(array $payload): self
    {
        AuthoringPayload::assertAllowedKeys($payload, ['schema', 'profile', 'version'], 'Device Profile document');

        if (($payload['schema'] ?? null) !== 'iot.device-profile.authoring.v2') {
            throw new InvalidArgumentException('Unsupported Device Profile authoring schema.');
        }

        $profile = AuthoringPayload::object($payload['profile'] ?? null, 'profile');
        AuthoringPayload::assertAllowedKeys($profile, ['uuid', 'key', 'name', 'description'], 'profile');
        AuthoringPayload::uuid($profile['uuid'] ?? null, 'profile.uuid');
        AuthoringPayload::key($profile['key'] ?? null, 'profile.key');
        DeviceDomainV2Payload::boundedString($profile['name'] ?? null, 'profile.name', 160);
        DeviceDomainV2Payload::nullableBoundedString($profile['description'] ?? null, 'profile.description', 4000);

        $version = AuthoringPayload::object($payload['version'] ?? null, 'version');
        AuthoringPayload::assertAllowedKeys($version, [
            'uuid',
            'version',
            'notes',
            'parameters',
            'derived_parameters',
            'properties',
            'events',
            'commands',
        ], 'version');
        AuthoringPayload::uuid($version['uuid'] ?? null, 'version.uuid');
        AuthoringPayload::positiveInteger($version['version'] ?? null, 'version.version');
        DeviceDomainV2Payload::nullableBoundedString($version['notes'] ?? null, 'version.notes', 4000);
        self::validateVersion($version);

        return new self($profile, DeviceDomainV2JsonShape::profileVersion($version));
    }

    public function profileUuid(): string
    {
        return strtolower((string) $this->profile['uuid']);
    }

    public function profileKey(): string
    {
        return (string) $this->profile['key'];
    }

    public function profileName(): string
    {
        return (string) $this->profile['name'];
    }

    public function profileDescription(): ?string
    {
        return $this->profile['description'] ?? null;
    }

    public function versionUuid(): string
    {
        return strtolower((string) $this->version['uuid']);
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

    /** @return array<string, string> */
    public function parameterIdentityMap(): array
    {
        $identities = [];

        foreach ([...$this->version['parameters'], ...$this->version['derived_parameters']] as $parameter) {
            $identities[(string) $parameter['key']] = strtolower((string) $parameter['uuid']);
        }

        ksort($identities);

        return $identities;
    }

    /** @return list<string> */
    public function parameterUuids(): array
    {
        return $this->identityUuids([...$this->version['parameters'], ...$this->version['derived_parameters']]);
    }

    /** @return list<string> */
    public function measuredParameterUuids(): array
    {
        return $this->identityUuids($this->version['parameters']);
    }

    /** @return list<string> */
    public function propertyUuids(): array
    {
        return $this->identityUuids($this->version['properties']);
    }

    /** @return list<string> */
    public function transportPropertyUuids(): array
    {
        return $this->identityUuids(array_values(array_filter(
            $this->version['properties'],
            static fn (array $property): bool => $property['scope'] !== 'platform',
        )));
    }

    /** @return list<string> */
    public function eventUuids(): array
    {
        return $this->identityUuids($this->version['events']);
    }

    /** @return list<string> */
    public function eventFieldUuids(): array
    {
        $fields = [];

        foreach ($this->version['events'] as $event) {
            $fields = [...$fields, ...$event['fields']];
        }

        return $this->identityUuids($fields);
    }

    /** @return list<string> */
    public function commandUuids(): array
    {
        return $this->identityUuids($this->version['commands']);
    }

    /** @return list<string> */
    public function commandFieldUuids(): array
    {
        $fields = [];

        foreach ($this->version['commands'] as $command) {
            $fields = [...$fields, ...$command['fields']];
        }

        return $this->identityUuids($fields);
    }

    /** @return array<string, array<string, mixed>> */
    public function measuredParametersByUuid(): array
    {
        return $this->itemsByUuid($this->version['parameters']);
    }

    /** @return array<string, array<string, mixed>> */
    public function propertiesByUuid(): array
    {
        return $this->itemsByUuid($this->version['properties']);
    }

    /** @return array<string, array<string, mixed>> */
    public function eventsByUuid(): array
    {
        return $this->itemsByUuid($this->version['events']);
    }

    /** @return array<string, array<string, mixed>> */
    public function commandsByUuid(): array
    {
        return $this->itemsByUuid($this->version['commands']);
    }

    public function assertCompatibleCloneOf(self $source): void
    {
        if ($this->parameterIdentityMap() !== $source->parameterIdentityMap()) {
            throw new InvalidArgumentException('A compatible Profile clone must preserve parameter UUIDs.');
        }
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'schema' => 'iot.device-profile.authoring.v2',
            'profile' => $this->profile,
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
        $parameters = AuthoringPayload::list($version['parameters'] ?? null, 'version.parameters');
        $derived = AuthoringPayload::list($version['derived_parameters'] ?? null, 'version.derived_parameters');
        $properties = AuthoringPayload::list($version['properties'] ?? null, 'version.properties');
        $events = AuthoringPayload::list($version['events'] ?? null, 'version.events');
        $commands = AuthoringPayload::list($version['commands'] ?? null, 'version.commands');

        DeviceDomainV2Payload::assertMaximumItems($parameters, 1024, 'version.parameters');
        DeviceDomainV2Payload::assertMaximumItems($derived, 256, 'version.derived_parameters');
        DeviceDomainV2Payload::assertMaximumItems($properties, 256, 'version.properties');
        DeviceDomainV2Payload::assertMaximumItems($events, 256, 'version.events');
        DeviceDomainV2Payload::assertMaximumItems($commands, 256, 'version.commands');

        $seenUuids = [];
        $parameterKeys = [];
        $parameterUuids = [];
        $derivedGraph = [];
        $derivedSources = [];

        foreach ($parameters as $index => $value) {
            $path = "version.parameters.{$index}";
            $parameter = self::identityObject(
                $value,
                $path,
                ['uuid', 'key', 'label', 'description', 'value_schema', 'presentation'],
                $seenUuids,
                $parameterKeys,
            );
            DeviceDomainV2Payload::valueSchema($parameter['value_schema'] ?? null, "{$path}.value_schema");
            self::optionalPresentation($parameter, $path);
            $parameterUuids[strtolower((string) $parameter['uuid'])] = true;
        }

        foreach ($derived as $index => $value) {
            $path = "version.derived_parameters.{$index}";
            $parameter = self::identityObject(
                $value,
                $path,
                ['uuid', 'key', 'label', 'description', 'value_schema', 'expression', 'dependencies', 'presentation'],
                $seenUuids,
                $parameterKeys,
            );
            DeviceDomainV2Payload::valueSchema($parameter['value_schema'] ?? null, "{$path}.value_schema");
            self::optionalPresentation($parameter, $path);

            $expression = AuthoringPayload::object($parameter['expression'] ?? null, "{$path}.expression");
            AuthoringPayload::assertAllowedKeys($expression, ['language', 'source'], "{$path}.expression");

            if (($expression['language'] ?? null) !== 'cel') {
                throw new InvalidArgumentException("{$path}.expression.language must be cel.");
            }

            $source = DeviceDomainV2Payload::celExpression(
                $expression['source'] ?? null,
                "{$path}.expression.source",
            );
            $uuid = strtolower((string) $parameter['uuid']);
            $dependencies = self::uuidList($parameter['dependencies'] ?? null, "{$path}.dependencies", 64);

            if (in_array($uuid, $dependencies, true)) {
                throw new InvalidArgumentException("{$path}.dependencies cannot reference itself.");
            }

            $parameterUuids[$uuid] = true;
            $derivedGraph[$uuid] = $dependencies;
            $derivedSources[$uuid] = [$source, $path];
        }

        foreach ($derivedGraph as $uuid => $dependencies) {
            foreach ($dependencies as $dependency) {
                if (! isset($parameterUuids[$dependency])) {
                    throw new InvalidArgumentException("Derived parameter {$uuid} references unknown dependency {$dependency}.");
                }
            }

            [$source, $path] = $derivedSources[$uuid];
            $references = self::celParameterReferences($source);
            $expected = $dependencies;
            sort($references);
            sort($expected);

            if ($references !== $expected) {
                throw new InvalidArgumentException("{$path}.expression.source must reference exactly its dependency UUIDs through p['uuid'].");
            }
        }

        self::assertAcyclic($derivedGraph);
        self::validateProperties($properties, $seenUuids);
        self::validateEvents($events, $seenUuids);
        self::validateCommands($commands, $seenUuids);
    }

    /**
     * @param  list<string>  $allowedKeys
     * @param  array<string, bool>  $seenUuids
     * @param  array<string, bool>  $seenKeys
     * @return array<string, mixed>
     */
    private static function identityObject(
        mixed $value,
        string $path,
        array $allowedKeys,
        array &$seenUuids,
        array &$seenKeys,
    ): array {
        $item = AuthoringPayload::object($value, $path);
        AuthoringPayload::assertAllowedKeys($item, $allowedKeys, $path);
        $uuid = AuthoringPayload::uuid($item['uuid'] ?? null, "{$path}.uuid");
        $key = AuthoringPayload::key($item['key'] ?? null, "{$path}.key");
        DeviceDomainV2Payload::boundedString($item['label'] ?? null, "{$path}.label", 160);
        DeviceDomainV2Payload::nullableBoundedString($item['description'] ?? null, "{$path}.description", 4000);

        if (isset($seenUuids[$uuid])) {
            throw new InvalidArgumentException("{$path}.uuid duplicates {$uuid}.");
        }

        if (isset($seenKeys[$key])) {
            throw new InvalidArgumentException("{$path}.key duplicates {$key}.");
        }

        $seenUuids[$uuid] = true;
        $seenKeys[$key] = true;

        return $item;
    }

    /** @param array<string, mixed> $item */
    private static function optionalPresentation(array $item, string $path): void
    {
        if (array_key_exists('presentation', $item)) {
            DeviceDomainV2Payload::presentation($item['presentation'], "{$path}.presentation");
        }
    }

    /** @return list<string> */
    private static function uuidList(mixed $value, string $path, int $maximum): array
    {
        $values = AuthoringPayload::list($value, $path);

        if ($values === [] || count($values) > $maximum) {
            throw new InvalidArgumentException("{$path} must contain between 1 and {$maximum} UUIDs.");
        }

        $uuids = [];

        foreach ($values as $index => $uuid) {
            $normalized = AuthoringPayload::uuid($uuid, "{$path}.{$index}");

            if (in_array($normalized, $uuids, true)) {
                throw new InvalidArgumentException("{$path} contains duplicate UUID {$normalized}.");
            }

            $uuids[] = $normalized;
        }

        return $uuids;
    }

    /** @return list<string> */
    private static function celParameterReferences(string $source): array
    {
        preg_match_all('/p\[\s*[\'"]([0-9a-fA-F-]{36})[\'"]\s*\]/', $source, $matches);

        return array_values(array_unique(array_map('strtolower', $matches[1] ?? [])));
    }

    /** @param array<string, list<string>> $graph */
    private static function assertAcyclic(array $graph): void
    {
        $visiting = [];
        $visited = [];

        $visit = function (string $uuid) use (&$visit, &$visiting, &$visited, $graph): void {
            if (isset($visited[$uuid])) {
                return;
            }

            if (isset($visiting[$uuid])) {
                throw new InvalidArgumentException("Derived dependency cycle includes {$uuid}.");
            }

            $visiting[$uuid] = true;

            foreach ($graph[$uuid] ?? [] as $dependency) {
                if (isset($graph[$dependency])) {
                    $visit($dependency);
                }
            }

            unset($visiting[$uuid]);
            $visited[$uuid] = true;
        };

        foreach (array_keys($graph) as $uuid) {
            $visit($uuid);
        }
    }

    /** @param list<mixed> $properties @param array<string, bool> $seenUuids */
    private static function validateProperties(array $properties, array &$seenUuids): void
    {
        $keys = [];
        $byUuid = [];
        $acknowledgements = [];

        foreach ($properties as $index => $value) {
            $path = "version.properties.{$index}";
            $property = self::identityObject(
                $value,
                $path,
                ['uuid', 'key', 'label', 'description', 'scope', 'value_schema', 'acknowledgement', 'presentation'],
                $seenUuids,
                $keys,
            );
            $scope = DeviceDomainV2Payload::enum(
                $property['scope'] ?? null,
                ['platform', 'desired', 'reported'],
                "{$path}.scope",
            );
            DeviceDomainV2Payload::valueSchema($property['value_schema'] ?? null, "{$path}.value_schema");
            self::optionalPresentation($property, $path);

            $uuid = strtolower((string) $property['uuid']);
            $byUuid[$uuid] = $scope;

            if (array_key_exists('acknowledgement', $property)) {
                if ($scope !== 'desired') {
                    throw new InvalidArgumentException("{$path}.acknowledgement is only allowed for desired properties.");
                }

                $acknowledgement = AuthoringPayload::object(
                    $property['acknowledgement'],
                    "{$path}.acknowledgement",
                );
                AuthoringPayload::assertAllowedKeys(
                    $acknowledgement,
                    ['required', 'reported_property_uuid'],
                    "{$path}.acknowledgement",
                );
                AuthoringPayload::boolean(
                    $acknowledgement['required'] ?? null,
                    "{$path}.acknowledgement.required",
                );

                $reportedUuid = null;

                if (array_key_exists('reported_property_uuid', $acknowledgement)) {
                    $reportedUuid = $acknowledgement['reported_property_uuid'] === null
                        ? null
                        : AuthoringPayload::uuid(
                            $acknowledgement['reported_property_uuid'],
                            "{$path}.acknowledgement.reported_property_uuid",
                        );
                }

                $acknowledgements[] = [$reportedUuid, $path];
            }
        }

        foreach ($acknowledgements as [$reportedUuid, $path]) {
            if ($reportedUuid !== null && ($byUuid[$reportedUuid] ?? null) !== 'reported') {
                throw new InvalidArgumentException("{$path}.acknowledgement must reference a reported property UUID.");
            }
        }
    }

    /** @param list<mixed> $events @param array<string, bool> $seenUuids */
    private static function validateEvents(array $events, array &$seenUuids): void
    {
        $keys = [];

        foreach ($events as $index => $value) {
            $path = "version.events.{$index}";
            $event = self::identityObject(
                $value,
                $path,
                ['uuid', 'key', 'label', 'description', 'mode', 'default_severity', 'dedupe_window_seconds', 'fields'],
                $seenUuids,
                $keys,
            );
            DeviceDomainV2Payload::enum($event['mode'] ?? null, ['stateless', 'stateful'], "{$path}.mode");
            DeviceDomainV2Payload::enum(
                $event['default_severity'] ?? null,
                ['info', 'notice', 'warning', 'critical'],
                "{$path}.default_severity",
            );

            if (array_key_exists('dedupe_window_seconds', $event) && $event['dedupe_window_seconds'] !== null) {
                DeviceDomainV2Payload::integerBetween(
                    $event['dedupe_window_seconds'],
                    0,
                    86400,
                    "{$path}.dedupe_window_seconds",
                );
            }

            $fields = AuthoringPayload::list($event['fields'] ?? null, "{$path}.fields");
            DeviceDomainV2Payload::assertMaximumItems($fields, 64, "{$path}.fields");
            $fieldKeys = [];

            foreach ($fields as $fieldIndex => $fieldValue) {
                $fieldPath = "{$path}.fields.{$fieldIndex}";
                $field = self::identityObject(
                    $fieldValue,
                    $fieldPath,
                    ['uuid', 'key', 'label', 'description', 'value_schema', 'presentation'],
                    $seenUuids,
                    $fieldKeys,
                );
                DeviceDomainV2Payload::valueSchema($field['value_schema'] ?? null, "{$fieldPath}.value_schema");
                self::optionalPresentation($field, $fieldPath);
            }
        }
    }

    /** @param list<mixed> $commands @param array<string, bool> $seenUuids */
    private static function validateCommands(array $commands, array &$seenUuids): void
    {
        $keys = [];

        foreach ($commands as $index => $value) {
            $path = "version.commands.{$index}";
            $command = self::identityObject(
                $value,
                $path,
                [
                    'uuid',
                    'key',
                    'label',
                    'description',
                    'mode',
                    'risk',
                    'confirmation_text',
                    'timeout_seconds',
                    'offline_policy',
                    'idempotent',
                    'max_attempts',
                    'fields',
                ],
                $seenUuids,
                $keys,
            );
            $mode = DeviceDomainV2Payload::enum(
                $command['mode'] ?? null,
                ['one_way', 'two_way'],
                "{$path}.mode",
            );
            $risk = DeviceDomainV2Payload::enum(
                $command['risk'] ?? null,
                ['low', 'medium', 'high'],
                "{$path}.risk",
            );
            DeviceDomainV2Payload::integerBetween(
                $command['timeout_seconds'] ?? null,
                1,
                86400,
                "{$path}.timeout_seconds",
            );
            DeviceDomainV2Payload::enum(
                $command['offline_policy'] ?? null,
                ['reject', 'queue_until_expiry'],
                "{$path}.offline_policy",
            );
            $idempotent = AuthoringPayload::boolean($command['idempotent'] ?? null, "{$path}.idempotent");
            $maxAttempts = DeviceDomainV2Payload::integerBetween(
                $command['max_attempts'] ?? null,
                1,
                10,
                "{$path}.max_attempts",
            );

            if (array_key_exists('confirmation_text', $command)) {
                DeviceDomainV2Payload::nullableBoundedString(
                    $command['confirmation_text'],
                    "{$path}.confirmation_text",
                    1000,
                );
            }

            if (in_array($risk, ['medium', 'high'], true)) {
                DeviceDomainV2Payload::boundedString(
                    $command['confirmation_text'] ?? null,
                    "{$path}.confirmation_text",
                    1000,
                );
            }

            if (! $idempotent && $maxAttempts !== 1) {
                throw new InvalidArgumentException("{$path}.max_attempts must be 1 for a non-idempotent Command.");
            }

            $fields = AuthoringPayload::list($command['fields'] ?? null, "{$path}.fields");
            DeviceDomainV2Payload::assertMaximumItems($fields, 64, "{$path}.fields");
            $fieldKeys = [];
            $hasOutput = false;

            foreach ($fields as $fieldIndex => $fieldValue) {
                $fieldPath = "{$path}.fields.{$fieldIndex}";
                $field = self::identityObject(
                    $fieldValue,
                    $fieldPath,
                    ['uuid', 'direction', 'key', 'label', 'description', 'required', 'value_schema', 'presentation'],
                    $seenUuids,
                    $fieldKeys,
                );
                $direction = DeviceDomainV2Payload::enum(
                    $field['direction'] ?? null,
                    DeviceDomainV2Payload::COMMAND_FIELD_DIRECTIONS,
                    "{$fieldPath}.direction",
                );
                $hasOutput = $hasOutput || $direction === 'output';
                AuthoringPayload::boolean($field['required'] ?? null, "{$fieldPath}.required");
                DeviceDomainV2Payload::valueSchema($field['value_schema'] ?? null, "{$fieldPath}.value_schema");
                self::optionalPresentation($field, $fieldPath);
            }

            if ($mode === 'two_way' && ! $hasOutput) {
                throw new InvalidArgumentException("{$path} two-way Command requires an output field.");
            }

            if ($mode === 'one_way' && $hasOutput) {
                throw new InvalidArgumentException("{$path} one-way Command cannot contain output fields.");
            }
        }
    }

    /** @param list<array<string, mixed>> $items @return list<string> */
    private function identityUuids(array $items): array
    {
        return array_values(array_map(
            static fn (array $item): string => strtolower((string) $item['uuid']),
            $items,
        ));
    }

    /** @param list<array<string, mixed>> $items @return array<string, array<string, mixed>> */
    private function itemsByUuid(array $items): array
    {
        $byUuid = [];

        foreach ($items as $item) {
            $byUuid[strtolower((string) $item['uuid'])] = $item;
        }

        return $byUuid;
    }
}
