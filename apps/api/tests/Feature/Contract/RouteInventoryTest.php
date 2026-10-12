<?php

declare(strict_types=1);

namespace Tests\Feature\Contract;

use App\Domain\Integrations\Http\AuthenticateApplication;
use App\Support\Contract\ContractFiles;
use App\Support\Contract\ContractJson;
use Illuminate\Auth\Middleware\Authenticate;
use Illuminate\Routing\Route;
use Illuminate\Routing\Router;
use Tests\TestCase;

/**
 * Gate G2 (specs/001-openapi-contract/contracts/ci-gate.md): the committed contract and
 * the router agree. It reads the router itself, because Scramble can skip a route it
 * fails to analyse, and it derives each expectation from the middleware on its own.
 */
final class RouteInventoryTest extends TestCase
{
    private const FIX = 'run php artisan contract:export and commit contracts/openapi/openapi.json';

    public function test_every_in_scope_route_has_an_operation(): void
    {
        $missing = array_keys(array_diff_key($this->routes(), $this->operations()));

        $this->assertNoFailures(array_map(static fn (string $key): string => "{$key}: route has no operation in the contract", $missing));
    }

    public function test_every_operation_has_a_route(): void
    {
        $orphaned = array_keys(array_diff_key($this->operations(), $this->routes()));

        $this->assertNoFailures(array_map(static fn (string $key): string => "{$key}: operation has no route", $orphaned));
    }

    public function test_security_matches_the_authentication_middleware(): void
    {
        $operations = $this->operations();
        $mismatched = [];
        foreach ($this->routes() as $key => $route) {
            $middleware = $this->middleware($route);
            $expected = match (true) {
                isset($middleware[Authenticate::class]) && $middleware[Authenticate::class] === 'sanctum' => [['session' => []]],
                isset($middleware[AuthenticateApplication::class]) => [['applicationToken' => []]],
                default => [],
            };
            $actual = $operations[$key]['security'] ?? null;
            if (isset($operations[$key]) && $actual !== $expected) {
                $mismatched[] = "{$key}: security is ".json_encode($actual).' but the middleware gives '.json_encode($expected);
            }
        }

        $this->assertNoFailures($mismatched);
    }

    public function test_integration_operations_require_the_middleware_ability(): void
    {
        $operations = $this->operations();
        $mismatched = [];
        foreach ($this->routes() as $key => $route) {
            $ability = $this->middleware($route)[AuthenticateApplication::class] ?? null;
            if ($ability === null || ! isset($operations[$key])) {
                continue;
            }
            if (! in_array($ability, $operations[$key]['x-abilities']['all'] ?? [], true)) {
                $mismatched[] = "{$key}: x-abilities.all lacks {$ability}, the ability its middleware requires";
            }
        }

        $this->assertNoFailures($mismatched);
    }

    public function test_organization_routes_are_marked_organization_scoped(): void
    {
        $operations = $this->operations();
        $unmarked = [];
        foreach ($this->routes() as $key => $route) {
            if (preg_match('#^api/(integration/)?v1/organizations/\{organization\}(/|$)#', $route->uri())
                && isset($operations[$key]) && ($operations[$key]['x-organization-scoped'] ?? null) !== true) {
                $unmarked[] = "{$key}: organization route lacks x-organization-scoped: true";
            }
        }

        $this->assertNoFailures($unmarked);
    }

    public function test_no_out_of_scope_path_is_described(): void
    {
        $outside = array_values(array_filter(
            array_keys($this->document()['paths'] ?? []),
            static fn (string $path): bool => ! str_starts_with($path, '/v1/') && ! str_starts_with($path, '/integration/v1/'),
        ));

        $this->assertNoFailures(array_map(static fn (string $path): string => "{$path}: outside /v1 and /integration/v1, so not part of the public contract", $outside));
    }

    /**
     * @return array<string, mixed>
     */
    private function document(): array
    {
        $this->assertFileExists(ContractFiles::document(), 'contract G2: openapi.json is missing'."\n  fix: ".self::FIX);

        return ContractJson::decode((string) file_get_contents(ContractFiles::document()));
    }

    /**
     * @return array<string, array<string, mixed>> operations keyed `METHOD /path`
     */
    private function operations(): array
    {
        $operations = [];
        foreach ($this->document()['paths'] ?? [] as $path => $item) {
            foreach ((array) $item as $method => $operation) {
                if (in_array($method, ['get', 'put', 'post', 'delete', 'patch'], true)) {
                    $operations[strtoupper($method).' '.$path] = $operation;
                }
            }
        }

        return $operations;
    }

    /**
     * Routes under api/v1 and api/integration/v1, one per method except HEAD.
     *
     * @return array<string, Route>
     */
    private function routes(): array
    {
        $routes = [];
        foreach (app(Router::class)->getRoutes()->getRoutes() as $route) {
            if (! preg_match('#^api/(integration/)?v1/#', $route->uri())) {
                continue;
            }
            foreach (array_diff($route->methods(), ['HEAD']) as $method) {
                $routes[$method.' /'.substr($route->uri(), strlen('api/'))] = $route;
            }
        }

        return $routes;
    }

    /**
     * @return array<string, string> middleware class => its parameters
     */
    private function middleware(Route $route): array
    {
        $middleware = [];
        foreach (app(Router::class)->gatherRouteMiddleware($route) as $entry) {
            if (is_string($entry)) {
                [$class, $parameters] = array_pad(explode(':', $entry, 2), 2, '');
                $middleware[$class] = $parameters;
            }
        }

        return $middleware;
    }

    /**
     * @param  list<string>  $failures  `<subject>: <difference>`
     */
    private function assertNoFailures(array $failures): void
    {
        $this->assertSame([], $failures, implode("\n", array_map(static fn (string $failure): string => "contract G2: {$failure}\n  fix: ".self::FIX, $failures)));
    }
}
