<?php

declare(strict_types=1);

namespace App\Support\Contract;

use Opis\JsonSchema\Errors\ErrorFormatter;
use Opis\JsonSchema\Validator;

/**
 * Locations of the contract files: contracts/openapi in a checkout, /var/contracts/openapi
 * in an image (see config/devices.php `contracts_path`).
 */
final class ContractFiles
{
    public static function directory(): string
    {
        $configured = config('scramble.contract.directory');
        $directory = is_string($configured) && $configured !== '' ? $configured : rtrim((string) config('devices.contracts_path'), '/').'/openapi';

        return rtrim(realpath($directory) ?: $directory, '/');
    }

    public static function document(): string
    {
        return self::directory().'/openapi.json';
    }

    public static function supplements(): string
    {
        return self::directory().'/supplements';
    }

    public static function pendingSchemas(): string
    {
        return self::directory().'/pending-schemas.json';
    }

    /**
     * Validates decoded JSON or YAML (objects, not arrays) against a schema in meta/.
     *
     * @return list<string> one line per problem, `<JSON pointer>: <message>`
     */
    public static function validate(mixed $data, string $metaSchema): array
    {
        $schemaPath = self::directory().'/meta/'.$metaSchema;
        if (! is_file($schemaPath)) {
            throw new ContractException("The meta schema {$schemaPath} is missing.");
        }
        $result = (new Validator(max_errors: 20, stop_at_first_error: false))
            ->validate($data, ContractJson::decodeObjects((string) file_get_contents($schemaPath)));
        if ($result->isValid()) {
            return [];
        }

        $problems = [];
        foreach ((new ErrorFormatter)->format($result->error()) as $pointer => $messages) {
            foreach ($messages as $message) {
                $problems[] = ($pointer === '' ? '/' : $pointer).': '.$message;
            }
        }

        return $problems;
    }
}
