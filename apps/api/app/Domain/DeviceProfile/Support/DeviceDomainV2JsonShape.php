<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Support;

final class DeviceDomainV2JsonShape
{
    /** @param array<string, mixed> $version @return array<string, mixed> */
    public static function profileVersion(array $version): array
    {
        foreach (['parameters', 'derived_parameters', 'properties'] as $collection) {
            foreach ($version[$collection] ?? [] as $index => $item) {
                if (! is_array($item)) {
                    continue;
                }

                self::normalizeValueSchema($item);
                $version[$collection][$index] = $item;
            }
        }

        foreach ($version['events'] ?? [] as $eventIndex => $event) {
            if (! is_array($event)) {
                continue;
            }

            foreach ($event['fields'] ?? [] as $fieldIndex => $field) {
                if (! is_array($field)) {
                    continue;
                }

                self::normalizeValueSchema($field);
                $event['fields'][$fieldIndex] = $field;
            }

            $version['events'][$eventIndex] = $event;
        }

        foreach ($version['commands'] ?? [] as $commandIndex => $command) {
            if (! is_array($command)) {
                continue;
            }

            foreach ($command['fields'] ?? [] as $fieldIndex => $field) {
                if (! is_array($field)) {
                    continue;
                }

                self::normalizeValueSchema($field);
                $command['fields'][$fieldIndex] = $field;
            }

            $version['commands'][$commandIndex] = $command;
        }

        return $version;
    }

    /** @param array<string, mixed> $version @return array<string, mixed> */
    public static function bindingVersion(array $version): array
    {
        foreach ($version['channels'] ?? [] as $index => $channel) {
            if (! is_array($channel)) {
                continue;
            }

            self::emptyObject($channel, 'envelope');
            $version['channels'][$index] = $channel;
        }

        foreach ($version['command_mappings'] ?? [] as $index => $mapping) {
            if (! is_array($mapping)) {
                continue;
            }

            self::emptyObject($mapping, 'request_template');

            if (is_array($mapping['request_envelope'] ?? null)) {
                self::emptyObject($mapping['request_envelope'], 'route_variable_paths');
            }

            $version['command_mappings'][$index] = $mapping;
        }

        return $version;
    }

    /** @param array<string, mixed> $item */
    private static function normalizeValueSchema(array &$item): void
    {
        if (! is_array($item['value_schema'] ?? null)) {
            return;
        }

        self::emptyObject($item['value_schema'], 'constraints');
    }

    /** @param array<string, mixed> $parent */
    private static function emptyObject(array &$parent, string $key): void
    {
        if (($parent[$key] ?? null) === []) {
            $parent[$key] = (object) [];
        }
    }

    private function __construct() {}
}
