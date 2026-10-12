<?php

declare(strict_types=1);

namespace App\Support\Contract;

/**
 * The "open schema" rule of gate G3 (specs/001-openapi-contract/contracts/ci-gate.md).
 *
 * A schema is open when it is `{}`; or has none of `$ref`, `type`, `properties`, `items`,
 * `oneOf`, `anyOf`, `allOf`, `enum` or `const`; or is `type: object` without `properties`,
 * `patternProperties` or an `additionalProperties` schema; or is `type: array` without
 * `items`. The check recurses through properties, items, combinators and internal
 * `$ref`s. An explicit `additionalProperties` schema states a free-form map on purpose,
 * so its value schema is not inspected.
 */
final class OpenSchema
{
    private const SHAPE_KEYWORDS = ['$ref', 'type', 'properties', 'items', 'oneOf', 'anyOf', 'allOf', 'enum', 'const'];

    /**
     * The schema written for the success bodies of a pending operation.
     *
     * @return array{description: string}
     */
    public static function pending(): array
    {
        return ['description' => 'Not described yet: this operation is on contracts/openapi/pending-schemas.json, so only its status codes are checked.'];
    }

    /**
     * JSON pointers (relative to the schema) of every open part; empty when closed.
     *
     * @param  array<string, mixed>  $document  for resolving `#/components/...` references
     * @return list<string>
     */
    public static function openParts(mixed $schema, array $document, string $pointer = ''): array
    {
        return self::walk($schema, $document, $pointer, []);
    }

    /**
     * @param  array<string, mixed>  $document
     * @param  array<string, true>  $visiting  references on the current path, to stop cycles
     * @return list<string>
     */
    private static function walk(mixed $schema, array $document, string $pointer, array $visiting): array
    {
        if (ContractJson::isEmptyObject($schema) || $schema === true) {
            return [$pointer === '' ? '/' : $pointer];
        }
        if (! is_array($schema)) {
            return [];
        }

        if (isset($schema['$ref']) && is_string($schema['$ref'])) {
            $ref = $schema['$ref'];
            if (! str_starts_with($ref, '#/') || isset($visiting[$ref])) {
                // External schemas in contracts/ are versioned contracts of their own.
                return [];
            }

            return self::walk(self::resolve($ref, $document), $document, $pointer, $visiting + [$ref => true]);
        }

        if (array_intersect(self::SHAPE_KEYWORDS, array_keys($schema)) === []) {
            return [$pointer === '' ? '/' : $pointer];
        }

        $types = (array) ($schema['type'] ?? []);
        if (in_array('object', $types, true) && ! isset($schema['properties']) && ! isset($schema['patternProperties'])
            && ! (isset($schema['additionalProperties']) && (is_array($schema['additionalProperties']) || is_object($schema['additionalProperties'])))) {
            return [$pointer === '' ? '/' : $pointer];
        }
        if (in_array('array', $types, true) && ! array_key_exists('items', $schema)) {
            return [$pointer === '' ? '/' : $pointer];
        }

        $open = [];
        foreach ((is_array($schema['properties'] ?? null) ? $schema['properties'] : []) as $name => $property) {
            array_push($open, ...self::walk($property, $document, $pointer.'/'.$name, $visiting));
        }
        if (array_key_exists('items', $schema)) {
            array_push($open, ...self::walk($schema['items'], $document, $pointer.'/*', $visiting));
        }
        foreach (['oneOf', 'anyOf', 'allOf'] as $combinator) {
            foreach ((is_array($schema[$combinator] ?? null) ? $schema[$combinator] : []) as $variant) {
                if (self::isNullType($variant)) {
                    continue;
                }
                array_push($open, ...self::walk($variant, $document, $pointer, $visiting));
            }
        }

        return array_values(array_unique($open));
    }

    /**
     * @param  array<string, mixed>  $document
     */
    public static function resolve(string $ref, array $document): mixed
    {
        $node = $document;
        foreach (explode('/', substr($ref, 2)) as $segment) {
            $segment = str_replace(['~1', '~0'], ['/', '~'], $segment);
            if (! is_array($node) || ! array_key_exists($segment, $node)) {
                throw new ContractException("The reference {$ref} points to nothing.");
            }
            $node = $node[$segment];
        }

        return $node;
    }

    private static function isNullType(mixed $schema): bool
    {
        return is_array($schema) && ($schema['type'] ?? null) === 'null' && count($schema) === 1;
    }
}
