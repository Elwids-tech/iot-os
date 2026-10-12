<?php

declare(strict_types=1);

namespace App\Support\Contracts;

use JsonException;
use Opis\JsonSchema\Errors\ValidationError;
use Opis\JsonSchema\Exceptions\SchemaException;
use stdClass;

/**
 * Validates values against the contracts of a {@see ContractRegistry}, in strict or
 * tolerant mode, and reports {keyword, instance_location} pairs, never values.
 *
 * Nothing in the running application calls it yet; spec 002 PR 9 adds the live
 * checks. Tests use it through Tests\Support\AssertsContracts.
 */
final class ContractValidator
{
    /** Inner errors reported in their own right, as the Python checker reports them; others only wrap their causes. */
    private const REPORTED_PARENTS = ['oneOf', 'anyOf', 'contains', 'minContains'];

    private readonly ContractRegistry $registry;

    public function __construct(?ContractRegistry $registry = null)
    {
        $this->registry = $registry ?? ContractRegistry::fromConfig();
    }

    public function registry(): ContractRegistry
    {
        return $this->registry;
    }

    /**
     * Checks a PHP value, judged by its JSON encoding (json_encode's defaults, as
     * Laravel sends it). An empty PHP array encodes as `[]`; pass a `stdClass`, or the
     * raw JSON to validateJson(), where an empty object is meant.
     *
     * @param  string  $contract  catalogue id, schema path under contracts/ or schema $id
     * @return list<ContractViolation> empty when the value conforms
     */
    public function validate(string $contract, mixed $value, ContractMode $mode): array
    {
        try {
            $json = json_encode($value, JSON_THROW_ON_ERROR);
        } catch (JsonException $exception) {
            throw new ContractUnavailable("Cannot encode the value for {$contract}: {$exception->getMessage()}", previous: $exception);
        }

        return $this->validateJson($contract, $json, $mode);
    }

    /**
     * @return list<ContractViolation> empty when the JSON conforms
     *
     * @throws JsonException when $json is not JSON
     */
    public function validateJson(string $contract, string $json, ContractMode $mode): array
    {
        $id = $this->registry->schemaId($contract);
        $data = json_decode($json, false, 512, JSON_THROW_ON_ERROR);
        try {
            $error = $this->registry->validator($mode)->validate($data, $id)->error();
        } catch (SchemaException $exception) {
            throw new ContractUnavailable("{$contract} does not compile: {$exception->getMessage()}", previous: $exception);
        }
        if ($error === null) {
            return [];
        }

        $violations = [];
        $this->collect($error, $violations);
        usort($violations, fn (ContractViolation $a, ContractViolation $b): int => [$a->instanceLocation, $a->keyword] <=> [$b->instanceLocation, $b->keyword]);
        $unique = [];
        foreach ($violations as $violation) {
            $unique[(string) $violation] ??= $violation;
        }

        return array_values($unique);
    }

    /**
     * Flattens the library's error tree: every leaf, plus the inner errors in
     * REPORTED_PARENTS. Groups, `$ref`, properties, items, allOf and the like only
     * wrap their causes.
     *
     * @param  list<ContractViolation>  $violations
     */
    private function collect(ValidationError $error, array &$violations): void
    {
        $keyword = $error->keyword();
        $children = $error->subErrors();
        if ($keyword !== '' && ($children === [] || in_array($keyword, self::REPORTED_PARENTS, true))) {
            $violation = $this->violation($error);
            if ($violation !== null) {
                $violations[] = $violation;
            }
        }
        foreach ($children as $child) {
            $this->collect($child, $violations);
        }
    }

    private function violation(ValidationError $error): ?ContractViolation
    {
        $keyword = $error->keyword();
        $args = $error->args();
        if ($keyword === 'additionalProperties' && ! $this->hasUndeclaredProperty($error)) {
            return null;
        }
        $missing = in_array($keyword, ['required', 'dependentRequired'], true) && is_array($args['missing'] ?? null)
            ? array_values(array_map('strval', $args['missing']))
            : [];

        return new ContractViolation($keyword, self::pointer($error->data()->fullPath()), $missing);
    }

    /**
     * opis/json-schema 2.6.0 reports every property of an object as additional once
     * one declared property fails its own schema. Only names that properties and
     * patternProperties do not cover are additional.
     */
    private function hasUndeclaredProperty(ValidationError $error): bool
    {
        $schema = $error->schema()->info()->data();
        $named = $schema instanceof stdClass && ($schema->properties ?? null) instanceof stdClass ? array_map('strval', array_keys(get_object_vars($schema->properties))) : [];
        $patterns = $schema instanceof stdClass && ($schema->patternProperties ?? null) instanceof stdClass ? array_map('strval', array_keys(get_object_vars($schema->patternProperties))) : [];
        foreach ((array) ($error->args()['properties'] ?? []) as $name) {
            $name = (string) $name;
            if (in_array($name, $named, true)) {
                continue;
            }
            foreach ($patterns as $pattern) {
                if (preg_match('/'.str_replace('/', '\/', $pattern).'/u', $name) === 1) {
                    continue 2;
                }
            }

            return true;
        }

        return false;
    }

    /**
     * @param  list<int|string>  $path
     */
    private static function pointer(array $path): string
    {
        return implode('', array_map(fn (int|string $part): string => '/'.str_replace(['~', '/'], ['~0', '~1'], (string) $part), $path));
    }
}
