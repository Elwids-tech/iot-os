<?php

declare(strict_types=1);

namespace App\Support\Contract;

use App\Domain\Integrations\Http\AuthenticateApplication;
use Illuminate\Auth\Middleware\Authenticate;
use Illuminate\Auth\Middleware\Authorize;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Cache\RateLimiting\Unlimited;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Routing\Route;
use Illuminate\Routing\Router;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;

/**
 * Describes what each route's middleware means for a caller: the security requirement,
 * `x-audience`, `x-abilities`, `x-organization-scoped`, `x-platform-permission`,
 * `x-rate-limits`, and the shared 401, 403, 404, 419 and 429 responses
 * (specs/001-openapi-contract/contracts/openapi-extensions.md).
 */
final class SecurityTransformer
{
    /**
     * Scramble's own error responses and the shared responses that describe them.
     */
    private const SCRAMBLE_RESPONSES = [
        'AuthenticationException' => 'Unauthenticated',
        'AuthorizationException' => 'Forbidden',
        'ModelNotFoundException' => 'NotFound',
        'NotFoundHttpException' => 'NotFound',
        'ValidationException' => 'ValidationFailed',
    ];

    private const UNSAFE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

    public function __construct(private readonly Router $router) {}

    /**
     * @param  array<string, mixed>  $document
     * @param  array<string, Route>  $routes  keyed by operation
     * @return array<string, mixed>
     */
    public function apply(array $document, array $routes): array
    {
        foreach ($document['paths'] ?? [] as $path => $item) {
            foreach ($item as $method => $operation) {
                if (! in_array($method, ContractRoutes::METHODS, true)) {
                    continue;
                }
                $key = strtoupper($method).' '.$path;
                if (! isset($routes[$key])) {
                    throw new ContractException("{$key} was generated but no in-scope route has that method and path.");
                }
                $document['paths'][$path][$method] = $this->describe($operation, $routes[$key], strtoupper($method), $path);
            }
        }

        foreach (array_keys(self::SCRAMBLE_RESPONSES) as $name) {
            unset($document['components']['responses'][$name]);
        }

        return $document;
    }

    /**
     * @param  array<string, mixed>  $operation
     * @return array<string, mixed>
     */
    private function describe(array $operation, Route $route, string $method, string $path): array
    {
        $middleware = $this->middleware($route);
        $key = "{$method} {$path}";

        $session = false;
        $ability = null;
        $permission = null;
        $limits = [];
        foreach ($middleware as [$class, $parameters]) {
            if ($class === Authenticate::class) {
                if ($parameters !== ['sanctum']) {
                    throw new ContractException("{$key} uses authentication middleware the contract does not know (auth:".implode(',', $parameters).'); describe the scheme in SecurityTransformer.');
                }
                $session = true;
            } elseif ($class === AuthenticateApplication::class) {
                $ability = $parameters[0] ?? throw new ContractException("{$key} uses AuthenticateApplication without an ability.");
            } elseif ($class === Authorize::class) {
                $permission = $parameters[0] ?? null;
            }
        }
        if ($session && $ability !== null) {
            throw new ContractException("{$key} accepts both a session and an application token; the contract describes one scheme per operation.");
        }
        foreach ($middleware as [$class, $parameters]) {
            if ($class === ThrottleRequests::class) {
                array_push($limits, ...$this->rateLimits($key, $parameters, $session));
            }
        }
        if ($ability !== null) {
            $limits[] = ['limit' => AuthenticateApplication::REQUESTS_PER_MINUTE, 'per' => 'minute', 'key' => 'application'];
        }

        $operation['security'] = match (true) {
            $session => [['session' => []]],
            $ability !== null => [['applicationToken' => []]],
            default => [],
        };
        $operation['x-audience'] = $this->audience($path);
        if ($ability !== null) {
            $operation['x-abilities'] = ['all' => [$ability]];
        }
        $organizationScoped = self::isOrganizationScoped($path);
        if ($organizationScoped) {
            $operation['x-organization-scoped'] = true;
        }
        if ($permission !== null) {
            $operation['x-platform-permission'] = $permission;
        }
        if ($limits !== []) {
            $operation['x-rate-limits'] = $limits;
        }

        $responses = $this->remapScrambleResponses($operation['responses'] ?? []);
        $shared = array_filter([
            401 => $session || $ability !== null ? 'Unauthenticated' : null,
            403 => $ability !== null || $permission !== null || ($session && $organizationScoped) ? 'Forbidden' : null,
            404 => $organizationScoped || $ability !== null || str_contains($path, '{') ? 'NotFound' : null,
            419 => in_array($method, self::UNSAFE_METHODS, true) && str_starts_with($path, '/v1/') ? 'CsrfExpired' : null,
            429 => $limits !== [] ? 'TooManyRequests' : null,
        ]);
        foreach ($shared as $status => $name) {
            $responses[$status] = ['$ref' => '#/components/responses/'.$name];
        }
        $operation['responses'] = $responses;

        return $operation;
    }

    public static function isOrganizationScoped(string $path): bool
    {
        return (bool) preg_match('#^/(v1|integration/v1)/organizations/\{organization\}(/|$)#', $path);
    }

    private function audience(string $path): string
    {
        return match (true) {
            str_starts_with($path, '/integration/') => 'integration',
            str_starts_with($path, '/v1/admin/') => 'platform-admin',
            str_starts_with($path, '/v1/organizations/{organization}') => 'organization',
            default => 'account',
        };
    }

    /**
     * @return list<array{0: string, 1: list<string>}> resolved class and parameters, in run order
     */
    private function middleware(Route $route): array
    {
        return array_map(static function (mixed $middleware): array {
            if (! is_string($middleware)) {
                return ['', []];
            }
            [$class, $parameters] = array_pad(explode(':', $middleware, 2), 2, '');

            // An ability such as "events:read" contains a colon, so it stays one parameter.
            return [$class, $parameters === '' ? [] : ($class === AuthenticateApplication::class ? [$parameters] : explode(',', $parameters))];
        }, $this->router->gatherRouteMiddleware($route));
    }

    /**
     * @param  list<string>  $parameters
     * @return list<array<string, int|string>>
     */
    private function rateLimits(string $key, array $parameters, bool $session): array
    {
        if (count($parameters) === 1 && ! is_numeric($parameters[0])) {
            return $this->namedLimits($key, $parameters[0]);
        }

        // throttle:N,M counts per signed-in user, otherwise per address.
        return [[
            'limit' => (int) ($parameters[0] ?? 60),
            'per' => $this->period($key, 60 * (int) ($parameters[1] ?? 1)),
            'key' => $session ? 'user' : 'ip',
        ]];
    }

    /**
     * Evaluates a named limiter (App\Providers\AppServiceProvider) with an empty request;
     * the limits and keys do not depend on the request's values.
     *
     * @return list<array<string, int|string>>
     */
    private function namedLimits(string $key, string $name): array
    {
        $limiter = RateLimiter::limiter($name) ?? throw new ContractException("{$key} uses the rate limiter '{$name}', which is not defined.");
        $result = $limiter(Request::create('/'));
        if ($result instanceof Unlimited) {
            return [];
        }

        $limits = [];
        foreach (is_array($result) ? $result : [$result] as $limit) {
            if (! $limit instanceof Limit) {
                throw new ContractException("{$key}: the rate limiter '{$name}' returns a response, which the contract cannot describe.");
            }
            $limits[] = [
                'limit' => $limit->maxAttempts,
                'per' => $this->period($key, $limit->decaySeconds),
                'key' => $this->limitKey($key, $name, (string) $limit->key),
                'name' => $name,
            ];
        }

        return $limits;
    }

    private function period(string $key, int $seconds): string
    {
        return match ($seconds) {
            60 => 'minute',
            3600 => 'hour',
            86400 => 'day',
            default => throw new ContractException("{$key} has a rate limit per {$seconds} seconds; x-rate-limits describes minutes, hours and days."),
        };
    }

    private function limitKey(string $key, string $name, string $limitKey): string
    {
        $prefix = Str::before($limitKey, ':');

        return match (true) {
            str_contains($prefix, 'application') => 'application',
            str_contains($prefix, 'organization') => 'organization',
            str_contains($prefix, 'email'), str_contains($prefix, 'account') => 'email',
            str_contains($prefix, 'user') => 'user',
            str_contains($prefix, 'ip') => 'ip',
            default => throw new ContractException("{$key}: cannot tell what the rate limiter '{$name}' counts by from its key '{$prefix}'; prefix the key with ip-, user-, email-, organization- or application-."),
        };
    }

    /**
     * @param  array<int|string, mixed>  $responses
     * @return array<int|string, mixed>
     */
    private function remapScrambleResponses(array $responses): array
    {
        foreach ($responses as $status => $response) {
            $ref = is_array($response) ? ($response['$ref'] ?? null) : null;
            $name = is_string($ref) ? Str::after($ref, '#/components/responses/') : null;
            if ($name !== null && isset(self::SCRAMBLE_RESPONSES[$name])) {
                $responses[$status] = ['$ref' => '#/components/responses/'.self::SCRAMBLE_RESPONSES[$name]];
            }
        }

        return $responses;
    }
}
