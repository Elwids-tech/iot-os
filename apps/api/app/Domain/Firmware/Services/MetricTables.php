<?php

declare(strict_types=1);

namespace App\Domain\Firmware\Services;

use InvalidArgumentException;

/**
 * Device-profile parameters as the SDK's metric tables (spec 026 R20 and kit layout, spec
 * 027 starter layout): generated/iotos_type_<id>.h per type, iotos_types.h and .c, and
 * generated/profiles/<code>.json for the people and agents writing the field side.
 *
 * A type is ['code', 'c_identifier', 'name', 'revision', 'artifact_uuid', 'metrics',
 * 'default_health'], with metrics from metrics().
 */
final class MetricTables
{
    public const MAX_TYPES = 8; // IOTOS_MAX_DEVICE_TYPES

    public const MAX_METRICS = 64; // IOTOS_MAX_METRICS_PER_TYPE

    public const TX_BUFFER = 4096; // IOTOS_TX_BUFFER

    public const DATATYPES = [
        'boolean' => 'Boolean', 'integer' => 'Int64', 'number' => 'Double', 'enum' => 'String',
        'string' => 'String', 'timestamp' => 'DateTime', 'bytes' => 'Bytes',
    ];

    private const C_DATATYPES = [
        'Boolean' => 'IOTOS_BOOLEAN', 'Int64' => 'IOTOS_INT64', 'Double' => 'IOTOS_DOUBLE',
        'String' => 'IOTOS_STRING', 'DateTime' => 'IOTOS_DATETIME', 'Bytes' => 'IOTOS_BYTES',
    ];

    /** The SDK's default gateway health table (firmware/sdk/include/iotos/iotos_health.h). */
    public const HEALTH = [
        ['uptime', 'Uptime', 'Int64', 's'],
        ['connection_type', 'Connection type', 'String', null],
        ['signal_strength', 'Signal strength', 'Double', 'dBm'],
        ['firmware_version', 'Firmware version', 'String', null],
        ['sdk_version', 'SDK version', 'String', null],
        ['devices_configured', 'Devices configured', 'Int64', null],
        ['devices_online', 'Devices online', 'Int64', null],
        ['reconnects', 'Reconnects', 'Int64', null],
    ];

    /**
     * The metrics a device publishes for an artifact definition: parameters that report
     * state and are not derived, in the definition's (alias) order.
     *
     * @return list<array{key: string, label: string, description: ?string, datatype: string, unit: ?string, writable: bool, enum_values: ?list<string>, min: int|float|null, max: int|float|null}>
     */
    public function metrics(array $definition): array
    {
        $metrics = [];
        foreach ($definition['parameters'] ?? [] as $parameter) {
            if (! ($parameter['reports_state'] ?? false) || ($parameter['kind'] ?? null) === 'derived') {
                continue;
            }
            $datatype = self::DATATYPES[$parameter['data_type'] ?? ''] ?? throw new InvalidArgumentException('Parameter '.($parameter['key'] ?? '?').' has an unknown data type.');
            $range = $this->range($parameter['validation'] ?? null);
            $values = $parameter['validation']['rule']['in'][1] ?? null;
            $metrics[] = [
                'key' => (string) $parameter['key'],
                'label' => (string) ($parameter['label'] ?? $parameter['key']),
                'description' => isset($parameter['description']) && is_string($parameter['description']) ? $parameter['description'] : null,
                'datatype' => $datatype,
                'unit' => is_string($parameter['unit'] ?? null) && $parameter['unit'] !== '' ? $parameter['unit'] : null,
                'writable' => (bool) ($parameter['accepts_command'] ?? false),
                'enum_values' => ($parameter['data_type'] ?? null) === 'enum' && is_array($values) && array_is_list($values) ? array_values(array_map('strval', $values)) : null,
                'min' => $range['min'] ?? null,
                'max' => $range['max'] ?? null,
            ];
        }

        return $metrics;
    }

    /** The default health table as metrics, for a gateway without a health profile. */
    public function healthMetrics(): array
    {
        return array_map(fn (array $row): array => [
            'key' => $row[0], 'label' => $row[1], 'description' => null, 'datatype' => $row[2], 'unit' => $row[3],
            'writable' => false, 'enum_values' => null, 'min' => null, 'max' => null,
        ], self::HEALTH);
    }

    /** @return list<string> the health metric names the SDK fills */
    public function healthKeys(): array
    {
        return array_column(self::HEALTH, 0);
    }

    /**
     * Distinct C identifiers for profile codes, in order: `[a-z0-9_]`, starting with a
     * letter, and a numeric suffix on a clash.
     *
     * @param  list<string>  $codes
     * @return list<string>
     */
    public function identifiers(array $codes, array $taken = []): array
    {
        $used = array_fill_keys($taken, true);
        $identifiers = [];
        foreach ($codes as $code) {
            $base = $candidate = $this->identifier($code);
            for ($n = 2; isset($used[$candidate]); $n++) {
                $candidate = $base.'_'.$n;
            }
            $identifiers[] = $candidate;
            $used[$candidate] = true;
        }

        return $identifiers;
    }

    /** A profile code as a C identifier: `[a-z0-9_]`, starting with a letter, at most 48 characters. */
    public function identifier(string $name): string
    {
        $identifier = $this->slug($name);

        return substr($identifier === '' || ! ctype_alpha($identifier[0]) ? 'p_'.$identifier : $identifier, 0, 48);
    }

    /** `[a-z0-9_]` only, for joining into a longer identifier. */
    public function slug(string $name): string
    {
        return trim((string) preg_replace('/[^a-z0-9]+/', '_', strtolower($name)), '_');
    }

    /** An upper estimate of a type's DBIRTH in bytes: MQTT header, a long topic, and each metric's name, alias, timestamp, datatype and value. */
    public function birthBytes(array $metrics): int
    {
        $bytes = 5 + 2 + 120 + 12;
        foreach ($metrics as $metric) {
            $bytes += 3 + 2 + strlen($metric['key']) + 5 + 7 + 2 + match ($metric['datatype']) {
                'Boolean' => 2, 'Double' => 9, 'Int64' => 11, 'DateTime' => 7, default => 2 + 32,
            };
        }

        return $bytes;
    }

    /**
     * generated/ for a node type and the downstream types (empty for a direct device).
     *
     * @return array<string, string> path under generated/ => contents
     */
    public function files(array $node, array $types, bool $gateway): array
    {
        $files = [];
        $all = [$node, ...$types];
        usort($all, fn (array $a, array $b): int => strcmp($a['c_identifier'], $b['c_identifier']));
        foreach ($all as $type) {
            $files['iotos_type_'.$type['c_identifier'].'.h'] = $this->typeHeader($type);
        }
        $files['iotos_types.h'] = $this->typesHeader($node, $types, $gateway);
        $files['iotos_types.c'] = $this->typesSource($node, $types, $all);
        foreach ([$node, ...$types] as $type) {
            if (! $type['default_health']) {
                $files['profiles/'.$type['code'].'.json'] = $this->profileJson($type, $gateway && $type === $node);
            }
        }
        ksort($files);

        return $files;
    }

    private function typeHeader(array $type): string
    {
        $id = $type['c_identifier'];
        $guard = 'IOTOS_TYPE_'.strtoupper($id).'_H';
        $title = $type['default_health']
            ? '/* The SDK\'s default gateway health table (iotos_health.h). Metric order is the alias order; do not edit. */'
            : '/* Profile '.$this->comment('"'.$type['name'].'" ('.$type['code'].')').' revision '.$type['revision'].'. Metric order is the alias order; do not edit. */';
        $lines = [$title, '#ifndef '.$guard, '#define '.$guard, '', '#include "iotos/iotos.h"', ''];
        $count = count($type['metrics']);
        if ($count > 0) {
            $lines[] = 'static const iotos_metric_def iotos_type_'.$id.'_metrics[] = {';
            foreach ($type['metrics'] as $metric) {
                $lines[] = '    {'.$this->string($metric['key']).', '.self::C_DATATYPES[$metric['datatype']].', '
                    .($metric['unit'] === null ? 'NULL' : $this->string($metric['unit'])).', '.($metric['writable'] ? 'true' : 'false').'},'
                    .($metric['writable'] ? ' /* accepts commands */' : '');
            }
            $lines[] = '};';
        }
        $lines[] = 'static const iotos_device_type iotos_type_'.$id.' = {';
        $lines[] = '    '.$this->string($type['code']).', '.$type['revision'].', '.($count > 0 ? 'iotos_type_'.$id.'_metrics' : 'NULL').', '.$count;
        $lines[] = '};';
        $lines[] = '';
        $lines[] = '#endif';

        return implode("\n", $lines)."\n";
    }

    private function typesHeader(array $node, array $types, bool $gateway): string
    {
        $slots = max(1, count($types));
        $nodeText = $node['default_health'] ? 'the SDK\'s default gateway health table' : $this->comment($node['name'].' ('.$node['code'].')');
        $typeText = $types === [] ? 'none, so the array holds a single NULL, which keeps it valid C99' : implode(', ', array_map(fn ($t) => $this->comment($t['code']), $types));

        return implode("\n", [
            '/* Generated by IoT OS: this starter\'s device types. Do not edit: an update replaces generated/.',
            ' * The SDK matches device types by address, so always use these two declarations, never a',
            ' * type header\'s own copy. */',
            '#ifndef IOTOS_KIT_TYPES_H',
            '#define IOTOS_KIT_TYPES_H',
            '',
            '#include "iotos/iotos.h"',
            '',
            '#define IOTOS_KIT_ROLE_GATEWAY '.($gateway ? 1 : 0).' /* '.($gateway ? '0 in a direct-device starter' : '1 in a gateway starter').' */',
            '#define IOTOS_KIT_TYPE_COUNT '.count($types),
            '',
            '/* The node\'s own metrics: '.$nodeText.'. */',
            'extern const iotos_device_type iotos_kit_node_type;',
            '/* The downstream device types: '.$typeText.'. */',
            'extern const iotos_device_type *const iotos_kit_types['.$slots.'];',
            '',
            '#endif',
        ])."\n";
    }

    private function typesSource(array $node, array $types, array $all): string
    {
        $lines = ['/* Generated by IoT OS. Do not edit: an update replaces generated/. */', '#include "iotos_types.h"', ''];
        foreach ($all as $type) {
            $lines[] = '#include "iotos_type_'.$type['c_identifier'].'.h"';
        }
        $id = $node['c_identifier'];
        $count = count($node['metrics']);
        $lines[] = '';
        $lines[] = 'const iotos_device_type iotos_kit_node_type = {'.$this->string($node['code']).', '.$node['revision'].', '
            .($count > 0 ? 'iotos_type_'.$id.'_metrics' : 'NULL').', '.$count.'};';
        $lines[] = 'const iotos_device_type *const iotos_kit_types['.max(1, count($types)).'] = {';
        foreach ($types as $type) {
            $lines[] = '    &iotos_type_'.$type['c_identifier'].',';
        }
        if ($types === []) {
            $lines[] = '    NULL,';
        }
        $lines[] = '};';

        return implode("\n", $lines)."\n";
    }

    private function profileJson(array $type, bool $gatewayNode): string
    {
        $health = $gatewayNode ? array_fill_keys($this->healthKeys(), true) : [];
        $profile = [
            'format' => 1,
            'code' => $type['code'],
            'name' => $type['name'],
            'revision' => $type['revision'],
            'artifact_uuid' => $type['artifact_uuid'],
            'c_identifier' => $type['c_identifier'],
            'role' => $gatewayNode ? 'gateway_node' : ($type['is_node'] ?? false ? 'direct_device' : 'device_type'),
            'metrics' => array_map(fn (array $metric): array => [...$metric, 'filled_by_sdk' => isset($health[$metric['key']])], $type['metrics']),
        ];

        return json_encode($profile, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)."\n";
    }

    /** A C string literal: printable ASCII as is, other bytes as octal escapes. */
    public function string(string $value): string
    {
        if (preg_match('/[\x00-\x1f\x7f]/', $value) === 1) {
            throw new InvalidArgumentException('Names and units cannot contain control characters.');
        }
        $out = '';
        foreach (str_split($value) as $byte) {
            $code = ord($byte);
            $out .= match (true) {
                $byte === '"' || $byte === '\\' => '\\'.$byte,
                $code >= 0x80 => sprintf('\\%03o', $code),
                $byte === '?' => '\\?', // no trigraphs
                default => $byte,
            };
        }

        return '"'.$out.'"';
    }

    /** Text for a C comment: no comment terminators, printable ASCII only. */
    public function comment(string $text): string
    {
        return str_replace(['*/', '/*'], ['* /', '/ *'], (string) preg_replace('/[^\x20-\x7e]/', '?', $text));
    }

    /** The `>=` and `<=` limits on the value in a parameter's validation rule. */
    private function range(mixed $validation): array
    {
        $rule = is_array($validation) ? ($validation['rule'] ?? null) : null;
        if (! is_array($rule)) {
            return [];
        }
        $conditions = is_array($rule['and'] ?? null) && array_is_list($rule['and']) ? $rule['and'] : [$rule];
        $range = [];
        foreach ($conditions as $condition) {
            foreach (['>=' => 'min', '<=' => 'max'] as $operator => $bound) {
                $operands = is_array($condition) ? ($condition[$operator] ?? null) : null;
                if (is_array($operands) && count($operands) === 2 && ($operands[0]['var'] ?? null) === 'value' && (is_int($operands[1]) || is_float($operands[1]))) {
                    $range[$bound] = $operands[1];
                }
            }
        }

        return $range;
    }
}
