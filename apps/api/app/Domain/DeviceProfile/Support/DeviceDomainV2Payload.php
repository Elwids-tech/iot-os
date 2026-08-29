<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Support;

use App\Domain\Shared\Data\AuthoringPayload;
use InvalidArgumentException;

final class DeviceDomainV2Payload
{
    /** @var list<string> */
    public const DATA_TYPES = ['float64', 'int64', 'uint64', 'boolean', 'string', 'bytes', 'state'];

    /** @var list<string> */
    public const BINDING_PURPOSES = [
        'telemetry',
        'reported_properties',
        'desired_properties',
        'event',
        'command_request',
        'command_response',
    ];

    /** @var list<string> */
    public const BINDING_DIRECTIONS = ['device_to_platform', 'platform_to_device'];

    /** @var list<string> */
    public const COMMAND_FIELD_DIRECTIONS = ['input', 'output'];

    /** @var list<string> */
    public const PATH_SCOPES = ['message', 'record', 'route'];

    /** @var list<string> */
    public const ON_MISSING_POLICIES = ['reject_message', 'omit_value', 'use_default'];

    /** @var list<string> */
    public const ON_INVALID_POLICIES = [
        'reject_message',
        'omit_value',
        'use_default',
        'clamp',
        'accept_with_bad_quality',
    ];

    /** @var list<string> */
    public const INPUT_WIDGETS = [
        'slider',
        'number_input',
        'switch',
        'select',
        'segmented_control',
        'text_input',
    ];

    /** @var list<string> */
    public const DISPLAY_WIDGETS = ['gauge', 'value_card', 'chart', 'status_badge'];

    /** @param list<string> $allowed */
    public static function enum(mixed $value, array $allowed, string $path): string
    {
        $normalized = self::boundedString($value, $path, 160);

        if (! in_array($normalized, $allowed, true)) {
            throw new InvalidArgumentException(sprintf(
                '%s must be one of: %s.',
                $path,
                implode(', ', $allowed),
            ));
        }

        return $normalized;
    }

    public static function boundedString(mixed $value, string $path, int $maximum): string
    {
        if (! is_string($value) || trim($value) === '') {
            throw new InvalidArgumentException("{$path} must be a non-empty string.");
        }

        if (mb_strlen($value) > $maximum) {
            throw new InvalidArgumentException("{$path} cannot exceed {$maximum} characters.");
        }

        return $value;
    }

    public static function nullableBoundedString(mixed $value, string $path, int $maximum): ?string
    {
        if ($value === null) {
            return null;
        }

        if (! is_string($value)) {
            throw new InvalidArgumentException("{$path} must be a string or null.");
        }

        if (mb_strlen($value) > $maximum) {
            throw new InvalidArgumentException("{$path} cannot exceed {$maximum} characters.");
        }

        return $value;
    }

    public static function integerBetween(mixed $value, int $minimum, int $maximum, string $path): int
    {
        if (! is_int($value) || $value < $minimum || $value > $maximum) {
            throw new InvalidArgumentException("{$path} must be an integer between {$minimum} and {$maximum}.");
        }

        return $value;
    }

    public static function number(mixed $value, string $path): int|float
    {
        if ((! is_int($value) && ! is_float($value)) || ! is_finite((float) $value)) {
            throw new InvalidArgumentException("{$path} must be a finite number.");
        }

        return $value;
    }

    /** @param list<mixed> $items */
    public static function assertMaximumItems(array $items, int $maximum, string $path): void
    {
        if (count($items) > $maximum) {
            throw new InvalidArgumentException("{$path} cannot contain more than {$maximum} items.");
        }
    }

    /** @return array<string, mixed> */
    public static function valueSchema(mixed $value, string $path): array
    {
        $schema = AuthoringPayload::object($value, $path);
        AuthoringPayload::assertAllowedKeys(
            $schema,
            ['data_type', 'unit_code', 'constraints', 'default_value'],
            $path,
        );

        self::enum($schema['data_type'] ?? null, self::DATA_TYPES, "{$path}.data_type");

        if (array_key_exists('unit_code', $schema)) {
            $unitCode = self::nullableBoundedString($schema['unit_code'], "{$path}.unit_code", 64);

            if (is_string($unitCode) && $unitCode === '') {
                throw new InvalidArgumentException("{$path}.unit_code must be non-empty or null.");
            }
        }

        self::valueConstraints($schema['constraints'] ?? null, "{$path}.constraints");

        return $schema;
    }

    /** @return array<string, mixed> */
    public static function presentation(mixed $value, string $path): array
    {
        $presentation = AuthoringPayload::object($value, $path);
        AuthoringPayload::assertAllowedKeys(
            $presentation,
            ['order', 'precision', 'input', 'display'],
            $path,
        );

        self::integerBetween($presentation['order'] ?? null, 0, 10000, "{$path}.order");

        if (array_key_exists('precision', $presentation)) {
            self::integerBetween($presentation['precision'], 0, 12, "{$path}.precision");
        }

        if (array_key_exists('input', $presentation)) {
            $input = AuthoringPayload::object($presentation['input'], "{$path}.input");
            AuthoringPayload::assertAllowedKeys($input, ['widget', 'placeholder'], "{$path}.input");
            self::enum($input['widget'] ?? null, self::INPUT_WIDGETS, "{$path}.input.widget");

            if (array_key_exists('placeholder', $input)) {
                self::nullableBoundedString($input['placeholder'], "{$path}.input.placeholder", 160);
            }
        }

        if (array_key_exists('display', $presentation)) {
            $display = AuthoringPayload::object($presentation['display'], "{$path}.display");
            AuthoringPayload::assertAllowedKeys($display, ['widget'], "{$path}.display");
            self::enum($display['widget'] ?? null, self::DISPLAY_WIDGETS, "{$path}.display.widget");
        }

        return $presentation;
    }

    /** @return array<string, mixed> */
    public static function pathReference(mixed $value, string $path): array
    {
        $reference = AuthoringPayload::object($value, $path);
        AuthoringPayload::assertAllowedKeys($reference, ['scope', 'json_path'], $path);
        self::enum($reference['scope'] ?? null, self::PATH_SCOPES, "{$path}.scope");
        self::jsonPath($reference['json_path'] ?? null, "{$path}.json_path");

        return $reference;
    }

    public static function jsonPath(mixed $value, string $path): string
    {
        $jsonPath = self::boundedString($value, $path, 512);

        if (preg_match("/^\\$(?:(?:\\.[A-Za-z_][A-Za-z0-9_-]*)|(?:\\['[^']+'\\])|(?:\\[[0-9]+\\]))*$/", $jsonPath) !== 1) {
            throw new InvalidArgumentException("{$path} must use the restricted definite JSONPath grammar.");
        }

        return $jsonPath;
    }

    public static function recordPath(mixed $value, string $path): string
    {
        $recordPath = self::boundedString($value, $path, 512);

        if (preg_match("/^\\$(?:(?:\\.[A-Za-z_][A-Za-z0-9_-]*)|(?:\\['[^']+'\\])|(?:\\[[0-9]+\\]))*(?:\\[\\*\\])?$/", $recordPath) !== 1) {
            throw new InvalidArgumentException("{$path} must use the restricted record JSONPath grammar.");
        }

        return $recordPath;
    }

    public static function topicTemplate(mixed $value, string $path): string
    {
        $topic = self::boundedString($value, $path, 512);

        if (str_contains($topic, '+') || str_contains($topic, '#') || str_contains($topic, "\0")) {
            throw new InvalidArgumentException("{$path} cannot contain MQTT wildcards or null bytes.");
        }

        return $topic;
    }

    public static function celExpression(mixed $value, string $path): string
    {
        $expression = self::boundedString($value, $path, 4096);

        if (preg_match('/\b(?:http|fetch|exec|eval|file|socket)\s*[.(]/i', $expression) === 1) {
            throw new InvalidArgumentException("{$path} contains an unsupported CEL symbol.");
        }

        return $expression;
    }

    /** @return list<mixed> */
    public static function calibrationPipeline(mixed $value, string $path): array
    {
        $operations = AuthoringPayload::list($value, $path);
        self::assertMaximumItems($operations, 16, $path);

        foreach ($operations as $index => $operationValue) {
            $operationPath = "{$path}.{$index}";
            $operation = AuthoringPayload::object($operationValue, $operationPath);
            $name = self::enum(
                $operation['op'] ?? null,
                ['multiply', 'divide', 'add', 'subtract', 'power', 'clamp', 'round', 'cel'],
                "{$operationPath}.op",
            );

            if (in_array($name, ['multiply', 'divide', 'add', 'subtract'], true)) {
                AuthoringPayload::assertAllowedKeys($operation, ['op', 'value'], $operationPath);
                $operand = self::number($operation['value'] ?? null, "{$operationPath}.value");

                if ($name === 'divide' && (float) $operand === 0.0) {
                    throw new InvalidArgumentException("{$operationPath}.value cannot be zero.");
                }

                continue;
            }

            if ($name === 'power') {
                AuthoringPayload::assertAllowedKeys($operation, ['op', 'exponent'], $operationPath);
                $exponent = self::number($operation['exponent'] ?? null, "{$operationPath}.exponent");

                if ($exponent < -16 || $exponent > 16) {
                    throw new InvalidArgumentException("{$operationPath}.exponent must be between -16 and 16.");
                }

                continue;
            }

            if ($name === 'clamp') {
                AuthoringPayload::assertAllowedKeys($operation, ['op', 'minimum', 'maximum'], $operationPath);

                if (! array_key_exists('minimum', $operation) && ! array_key_exists('maximum', $operation)) {
                    throw new InvalidArgumentException("{$operationPath} requires minimum or maximum.");
                }

                $minimum = array_key_exists('minimum', $operation)
                    ? self::number($operation['minimum'], "{$operationPath}.minimum")
                    : null;
                $maximum = array_key_exists('maximum', $operation)
                    ? self::number($operation['maximum'], "{$operationPath}.maximum")
                    : null;

                if ($minimum !== null && $maximum !== null && $minimum > $maximum) {
                    throw new InvalidArgumentException("{$operationPath}.minimum cannot exceed maximum.");
                }

                continue;
            }

            if ($name === 'round') {
                AuthoringPayload::assertAllowedKeys($operation, ['op', 'precision'], $operationPath);
                self::integerBetween($operation['precision'] ?? null, 0, 12, "{$operationPath}.precision");

                continue;
            }

            AuthoringPayload::assertAllowedKeys($operation, ['op', 'expression'], $operationPath);
            self::celExpression($operation['expression'] ?? null, "{$operationPath}.expression");
        }

        return $operations;
    }

    /** @param array<string, mixed> $mapping */
    public static function mappingPolicies(array $mapping, string $path): void
    {
        $onMissing = self::enum(
            $mapping['on_missing'] ?? null,
            self::ON_MISSING_POLICIES,
            "{$path}.on_missing",
        );
        $onInvalid = self::enum(
            $mapping['on_invalid'] ?? null,
            self::ON_INVALID_POLICIES,
            "{$path}.on_invalid",
        );
        $needsDefault = $onMissing === 'use_default' || $onInvalid === 'use_default';
        $hasDefault = array_key_exists('default_value', $mapping);

        if ($needsDefault !== $hasDefault) {
            $expectation = $needsDefault ? 'requires' : 'does not allow';

            throw new InvalidArgumentException("{$path} {$expectation} default_value for its policies.");
        }
    }

    /** @return list<string|int|float|bool|null> */
    public static function statusValues(mixed $value, string $path): array
    {
        $values = AuthoringPayload::list($value, $path);

        if ($values === [] || count($values) > 32) {
            throw new InvalidArgumentException("{$path} must contain between 1 and 32 values.");
        }

        $seen = [];

        foreach ($values as $index => $scalar) {
            self::jsonScalar($scalar, "{$path}.{$index}");
            $identity = self::scalarIdentity($scalar);

            if (isset($seen[$identity])) {
                throw new InvalidArgumentException("{$path} contains a duplicate value.");
            }

            $seen[$identity] = true;
        }

        /** @var list<string|int|float|bool|null> $values */
        return $values;
    }

    /** @param array<string, list<string|int|float|bool|null>> $groups */
    public static function assertDisjointStatusGroups(array $groups, string $path): void
    {
        $seen = [];

        foreach ($groups as $group => $values) {
            foreach ($values as $value) {
                $identity = self::scalarIdentity($value);

                if (isset($seen[$identity])) {
                    throw new InvalidArgumentException(sprintf(
                        '%s value appears in both %s and %s.',
                        $path,
                        $seen[$identity],
                        $group,
                    ));
                }

                $seen[$identity] = $group;
            }
        }
    }

    public static function jsonScalar(mixed $value, string $path, bool $allowNull = true): void
    {
        $valid = is_string($value)
            || is_int($value)
            || is_bool($value)
            || (is_float($value) && is_finite($value))
            || ($allowNull && $value === null);

        if (! $valid) {
            throw new InvalidArgumentException("{$path} must be a JSON scalar.");
        }
    }

    /** @param array<string, mixed> $constraints */
    private static function valueConstraints(mixed $value, string $path): array
    {
        $constraints = AuthoringPayload::object($value, $path);
        AuthoringPayload::assertAllowedKeys($constraints, [
            'minimum',
            'maximum',
            'exclusive_minimum',
            'exclusive_maximum',
            'multiple_of',
            'min_length',
            'max_length',
            'pattern',
            'allowed_values',
        ], $path);

        foreach (['minimum', 'maximum'] as $field) {
            if (array_key_exists($field, $constraints)) {
                self::number($constraints[$field], "{$path}.{$field}");
            }
        }

        if (
            isset($constraints['minimum'], $constraints['maximum'])
            && $constraints['minimum'] > $constraints['maximum']
        ) {
            throw new InvalidArgumentException("{$path}.minimum cannot exceed maximum.");
        }

        foreach (['exclusive_minimum', 'exclusive_maximum'] as $field) {
            if (array_key_exists($field, $constraints)) {
                AuthoringPayload::boolean($constraints[$field], "{$path}.{$field}");
            }
        }

        if (array_key_exists('multiple_of', $constraints)) {
            $multiple = self::number($constraints['multiple_of'], "{$path}.multiple_of");

            if ($multiple <= 0) {
                throw new InvalidArgumentException("{$path}.multiple_of must be greater than zero.");
            }
        }

        foreach (['min_length', 'max_length'] as $field) {
            if (array_key_exists($field, $constraints)) {
                self::integerBetween($constraints[$field], 0, PHP_INT_MAX, "{$path}.{$field}");
            }
        }

        if (
            isset($constraints['min_length'], $constraints['max_length'])
            && $constraints['min_length'] > $constraints['max_length']
        ) {
            throw new InvalidArgumentException("{$path}.min_length cannot exceed max_length.");
        }

        if (array_key_exists('pattern', $constraints)) {
            if (
                ! is_string($constraints['pattern'])
                || mb_strlen($constraints['pattern']) > 1024
            ) {
                throw new InvalidArgumentException("{$path}.pattern must be a string of at most 1024 characters.");
            }
        }

        if (array_key_exists('allowed_values', $constraints)) {
            $allowedValues = AuthoringPayload::list($constraints['allowed_values'], "{$path}.allowed_values");

            if ($allowedValues === [] || count($allowedValues) > 256) {
                throw new InvalidArgumentException("{$path}.allowed_values must contain between 1 and 256 values.");
            }

            $seen = [];

            foreach ($allowedValues as $index => $allowedValue) {
                self::jsonScalar($allowedValue, "{$path}.allowed_values.{$index}", false);
                $identity = self::scalarIdentity($allowedValue);

                if (isset($seen[$identity])) {
                    throw new InvalidArgumentException("{$path}.allowed_values contains a duplicate value.");
                }

                $seen[$identity] = true;
            }
        }

        return $constraints;
    }

    private static function scalarIdentity(mixed $value): string
    {
        if (is_int($value) || is_float($value)) {
            return 'number:'.sprintf('%.17g', (float) $value);
        }

        return get_debug_type($value).':'.json_encode($value, JSON_THROW_ON_ERROR);
    }

    private function __construct() {}
}
