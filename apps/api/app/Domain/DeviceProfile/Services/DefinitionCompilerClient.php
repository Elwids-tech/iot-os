<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Services;

use App\Domain\DeviceManagement\Data\GatewayAuthoringData;
use App\Domain\DeviceManagement\Data\GatewayRouteAuthoringData;
use App\Domain\DeviceProfile\Data\DefinitionCompileResultData;
use App\Domain\DeviceProfile\Data\DeviceProfileAuthoringData;
use App\Domain\DeviceProfile\Data\NativeMqttBindingAuthoringData;
use App\Domain\DeviceProfile\Exceptions\DefinitionCompilerAuthenticationException;
use App\Domain\DeviceProfile\Exceptions\DefinitionCompilerTransportException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use InvalidArgumentException;
use JsonException;

final class DefinitionCompilerClient
{
    private const ENDPOINT = '/internal/v1/definitions/compile';

    /**
     * @param  list<array<string, mixed>>  $fixtures
     */
    public function compile(
        string $organizationUuid,
        DeviceProfileAuthoringData $profile,
        NativeMqttBindingAuthoringData $binding,
        GatewayAuthoringData $gateway,
        GatewayRouteAuthoringData $route,
        array $fixtures,
    ): DefinitionCompileResultData {
        $configuration = $this->configuration();
        $payload = [
            'schema' => 'iot.definition-compile-request.v1',
            'organization_uuid' => $organizationUuid,
            'profile' => $profile->toArray(),
            'binding' => $binding->toArray(),
            'gateway' => $gateway->toArray(),
            'route' => $route->toArray(),
            'fixtures' => $fixtures,
        ];

        $lastFailure = null;
        for ($attempt = 1; $attempt <= $configuration['attempts']; $attempt++) {
            try {
                $response = Http::baseUrl($configuration['url'])
                    ->withToken($configuration['token'])
                    ->acceptJson()
                    ->asJson()
                    ->connectTimeout($configuration['connect_timeout_seconds'])
                    ->timeout($configuration['timeout_seconds'])
                    ->post(self::ENDPOINT, $payload);
            } catch (ConnectionException $exception) {
                $lastFailure = DefinitionCompilerTransportException::network($exception);
                if ($attempt < $configuration['attempts']) {
                    $this->delay($configuration['retry_delay_milliseconds']);

                    continue;
                }

                throw $lastFailure;
            }

            if (in_array($response->status(), [401, 403], true)) {
                throw new DefinitionCompilerAuthenticationException($response->status());
            }
            if ($response->serverError()) {
                $lastFailure = DefinitionCompilerTransportException::http($response->status());
                if ($attempt < $configuration['attempts']) {
                    $this->delay($configuration['retry_delay_milliseconds']);

                    continue;
                }

                throw $lastFailure;
            }
            if (! $response->successful()) {
                throw DefinitionCompilerTransportException::http($response->status());
            }

            return $this->result($response);
        }

        throw $lastFailure ?? DefinitionCompilerTransportException::configuration(
            'The definition compiler request did not execute.',
        );
    }

    /**
     * @return array{
     *     url: string,
     *     token: string,
     *     connect_timeout_seconds: int,
     *     timeout_seconds: int,
     *     attempts: int,
     *     retry_delay_milliseconds: int
     * }
     */
    private function configuration(): array
    {
        $url = rtrim((string) config('services.iot_runtime.url'), '/');
        $token = (string) config('services.iot_runtime.token');
        $connectTimeout = (int) config('services.iot_runtime.connect_timeout_seconds', 2);
        $timeout = (int) config('services.iot_runtime.timeout_seconds', 5);
        $attempts = (int) config('services.iot_runtime.attempts', 2);
        $retryDelay = (int) config('services.iot_runtime.retry_delay_milliseconds', 100);

        if ($url === '' || filter_var($url, FILTER_VALIDATE_URL) === false) {
            throw DefinitionCompilerTransportException::configuration(
                'The definition compiler URL is not configured with a valid absolute URL.',
            );
        }
        if (strlen($token) < 32) {
            throw DefinitionCompilerTransportException::configuration(
                'The definition compiler internal token must contain at least 32 bytes.',
            );
        }
        if ($connectTimeout < 1 || $timeout < 1 || $attempts < 1 || $attempts > 10 || $retryDelay < 0) {
            throw DefinitionCompilerTransportException::configuration(
                'The definition compiler retry and timeout configuration is invalid.',
            );
        }

        return [
            'url' => $url,
            'token' => $token,
            'connect_timeout_seconds' => $connectTimeout,
            'timeout_seconds' => $timeout,
            'attempts' => $attempts,
            'retry_delay_milliseconds' => $retryDelay,
        ];
    }

    private function result(Response $response): DefinitionCompileResultData
    {
        try {
            $payload = json_decode($response->body(), true, 512, JSON_THROW_ON_ERROR);
            if (! is_array($payload) || array_is_list($payload)) {
                throw new InvalidArgumentException('Compile result must be a JSON object.');
            }

            return DefinitionCompileResultData::fromArray($payload);
        } catch (JsonException|InvalidArgumentException $exception) {
            throw DefinitionCompilerTransportException::malformedResponse($exception);
        }
    }

    private function delay(int $milliseconds): void
    {
        if ($milliseconds > 0) {
            usleep($milliseconds * 1000);
        }
    }
}
