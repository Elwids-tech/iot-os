<?php

declare(strict_types=1);

namespace App\Support\Contract;

use Illuminate\Routing\Route;

/**
 * Writes each route's path constraints (`whereUuid`, `whereNumber`, `where`) into its
 * path parameters. Scramble does not read `Route::$wheres`, and a malformed value
 * returns 404 because the route does not match, so the constraint is part of the contract.
 */
final class PathConstraintTransformer
{
    private const UUID = '[\da-fA-F]{8}-[\da-fA-F]{4}-[\da-fA-F]{4}-[\da-fA-F]{4}-[\da-fA-F]{12}';

    private const NUMBER = '[0-9]+';

    /**
     * @param  array<string, mixed>  $document
     * @param  array<string, Route>  $routes  keyed by operation
     * @return array<string, mixed>
     */
    public function apply(array $document, array $routes): array
    {
        foreach ($document['paths'] ?? [] as $path => $item) {
            foreach ($item as $method => $operation) {
                if (! in_array($method, ContractRoutes::METHODS, true) || ! isset($routes[strtoupper($method).' '.$path])) {
                    continue;
                }
                $route = $routes[strtoupper($method).' '.$path];
                foreach ($operation['parameters'] ?? [] as $index => $parameter) {
                    if (($parameter['in'] ?? null) !== 'path') {
                        continue;
                    }
                    $document['paths'][$path][$method]['parameters'][$index] = $this->constrain($parameter, $route->wheres[$parameter['name']] ?? null);
                }
            }
        }

        return $document;
    }

    /**
     * @param  array<string, mixed>  $parameter
     * @return array<string, mixed>
     */
    private function constrain(array $parameter, ?string $pattern): array
    {
        if ($pattern === null) {
            return $parameter;
        }

        $parameter['schema'] = match ($pattern) {
            self::UUID => ['type' => 'string', 'format' => 'uuid'],
            self::NUMBER => ['type' => 'integer', 'minimum' => 0],
            default => ['type' => 'string', 'pattern' => '^(?:'.$pattern.')$'],
        };
        $note = 'A value that does not match returns 404.';
        $description = trim((string) ($parameter['description'] ?? ''));
        $parameter['description'] = $description === '' ? $note : rtrim($description, '.').'. '.$note;

        return $parameter;
    }
}
