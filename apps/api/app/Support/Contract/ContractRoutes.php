<?php

declare(strict_types=1);

namespace App\Support\Contract;

use Illuminate\Routing\Route;
use Illuminate\Routing\Router;
use Illuminate\Support\Str;

/**
 * The routes the public contract describes: `api/v1/*` and `api/integration/v1/*`.
 * `api/internal/*` and the operational routes outside /api are out of scope.
 */
final class ContractRoutes
{
    public const METHODS = ['get', 'put', 'post', 'delete', 'patch'];

    public static function inScope(Route $route): bool
    {
        foreach ((array) config('scramble.contract.route_prefixes', ['api/v1', 'api/integration/v1']) as $prefix) {
            if ($route->uri() === $prefix || Str::startsWith($route->uri(), $prefix.'/')) {
                return true;
            }
        }

        return false;
    }

    /**
     * Every method of a route except HEAD, so a GET|PUT route gives two operations.
     *
     * @return list<string>
     */
    public static function methods(Route $route): array
    {
        return array_values(array_filter($route->methods(), static fn (string $method): bool => $method !== 'HEAD'));
    }

    /**
     * `METHOD /path` with the path relative to the /api server, as in the contract.
     */
    public static function operationKey(string $method, Route $route): string
    {
        return strtoupper($method).' /'.Str::after($route->uri(), 'api/');
    }

    /**
     * @return array<string, Route> in-scope routes keyed by operation
     */
    public static function index(): array
    {
        $routes = [];
        foreach (app(Router::class)->getRoutes()->getRoutes() as $route) {
            if (! self::inScope($route)) {
                continue;
            }
            foreach (self::methods($route) as $method) {
                $routes[self::operationKey($method, $route)] = $route;
            }
        }

        return $routes;
    }
}
