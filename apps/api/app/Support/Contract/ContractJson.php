<?php

declare(strict_types=1);

namespace App\Support\Contract;

use stdClass;
use Symfony\Component\Yaml\Yaml;

/**
 * JSON and YAML handling for the contract files.
 *
 * Documents are PHP arrays, except that an empty JSON object stays a `stdClass`, so
 * `{}` (an open schema) and `[]` (no security, an empty list) survive a round trip.
 */
final class ContractJson
{
    public static function decode(string $json): mixed
    {
        return self::fromObjects(json_decode($json, false, 512, JSON_THROW_ON_ERROR));
    }

    /**
     * Raw decode for JSON Schema validation, which needs objects.
     */
    public static function decodeObjects(string $json): mixed
    {
        return json_decode($json, false, 512, JSON_THROW_ON_ERROR);
    }

    public static function parseYamlObjects(string $path): mixed
    {
        return Yaml::parseFile($path, Yaml::PARSE_OBJECT_FOR_MAP | Yaml::PARSE_EXCEPTION_ON_INVALID_TYPE);
    }

    /**
     * Two-space indentation, unescaped slashes and Unicode, and a trailing newline,
     * so the committed file is the same on every machine.
     */
    public static function encode(mixed $document): string
    {
        $json = json_encode($document, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        return preg_replace_callback('/^(?: {4})+/m', static fn (array $indent): string => str_repeat(' ', intdiv(strlen($indent[0]), 2)), $json)."\n";
    }

    /**
     * Objects with members become associative arrays; empty objects stay objects.
     */
    public static function fromObjects(mixed $value): mixed
    {
        if ($value instanceof stdClass) {
            $members = get_object_vars($value);

            return $members === [] ? new stdClass : array_map(self::fromObjects(...), $members);
        }

        return is_array($value) ? array_map(self::fromObjects(...), $value) : $value;
    }

    public static function isEmptyObject(mixed $value): bool
    {
        return $value instanceof stdClass && get_object_vars($value) === [];
    }
}
