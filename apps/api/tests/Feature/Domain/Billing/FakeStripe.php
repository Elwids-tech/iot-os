<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Billing;

use Stripe\ApiRequestor;
use Stripe\HttpClient\ClientInterface;

/**
 * Stripe's HTTP client, faked (spec 029 T106): each request is recorded, and answered by
 * the route registered for its method and path, or with Stripe's 404 error otherwise.
 * Nothing leaves the test.
 */
final class FakeStripe implements ClientInterface
{
    /** @var list<array{method: string, path: string, params: array<string, mixed>, headers: list<string>}> */
    public array $requests = [];

    /** @var array<string, array{0: array<string, mixed>|callable(array<string, mixed>): array<string, mixed>, 1: int}> */
    private array $routes = [];

    public static function install(): self
    {
        $fake = new self;
        ApiRequestor::setHttpClient($fake);

        return $fake;
    }

    public static function uninstall(): void
    {
        ApiRequestor::setHttpClient(null);
    }

    /**
     * @param  array<string, mixed>|callable(array<string, mixed>): array<string, mixed>  $response
     */
    public function on(string $method, string $path, array|callable $response, int $status = 200): self
    {
        $this->routes[strtoupper($method).' '.$path] = [$response, $status];

        return $this;
    }

    public function request($method, $absUrl, $headers, $params, $hasFile, $apiMode = 'v1', $maxNetworkRetries = null)
    {
        $path = (string) parse_url($absUrl, PHP_URL_PATH);
        $this->requests[] = ['method' => strtoupper($method), 'path' => $path, 'params' => $params, 'headers' => $headers];
        $route = $this->routes[strtoupper($method).' '.$path] ?? null;

        if ($route === null) {
            return [json_encode(['error' => ['type' => 'invalid_request_error', 'message' => "No fake for {$method} {$path}"]]), 404, []];
        }

        [$response, $status] = $route;

        return [json_encode(is_callable($response) ? $response($params) : $response), $status, ['request-id' => 'req_test']];
    }

    /**
     * @return list<array{method: string, path: string, params: array<string, mixed>, headers: list<string>}>
     */
    public function sent(string $method, string $path): array
    {
        return array_values(array_filter($this->requests, fn (array $request): bool => $request['method'] === strtoupper($method) && $request['path'] === $path));
    }

    /**
     * @param  array{headers: list<string>}  $request
     */
    public static function header(array $request, string $name): ?string
    {
        foreach ($request['headers'] as $header) {
            [$key, $value] = array_pad(explode(':', $header, 2), 2, '');
            if (strcasecmp(trim($key), $name) === 0) {
                return trim($value);
            }
        }

        return null;
    }
}
