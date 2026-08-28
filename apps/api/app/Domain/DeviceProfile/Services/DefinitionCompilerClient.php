<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Services;

use App\Domain\DeviceProfile\Data\DefinitionTestResultData;
use App\Domain\DeviceProfile\Data\DeviceProfileAuthoringData;
use App\Domain\DeviceProfile\Data\NativeMqttBindingAuthoringData;
use App\Domain\DeviceProfile\Exceptions\DefinitionCompilerTransportException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\Http;
use InvalidArgumentException;
use Throwable;

final class DefinitionCompilerClient
{
    private const ENDPOINT = '/internal/v1/definitions/compile';

    /**
     * @param  list<array<string, mixed>>  $fixtures
     */
    public function compile(
        DeviceProfileAuthoringData $profile,
        NativeMqttBindingAuthoringData $binding,
        array $fixtures,
    ): DefinitionTestResultData {
        $configuration = $this->configuration();

        try {
            $response = Http::baseUrl($configuration['url'])
                ->acceptJson()
                ->asJson()
                ->withToken($configuration['token'])
                ->connectTimeout($configuration['connect_timeout_seconds'])
                ->timeout($configuration['timeout_seconds'])
                ->retry(
                    $configuration['attempts'],
                    $configuration['retry_delay_milliseconds'],
                    static fn (Throwable $exception): bool => $exception instanceof ConnectionException
                        || ($exception instanceof RequestException && $exception->response->serverError()),
                    throw: false,
                )
                ->post(self::ENDPOINT, [
                    'schema' => 'iot.definition-compile-request.v1',
                    'profile' => $profile->toArray(),
                    'binding' => $binding->toArray(),
                    'fixtures' => $fixtures,
                ]);
        } catch (ConnectionException $exception) {
            throw DefinitionCompilerTransportException::network($exception);
        }

        if (! $response->successful()) {
            throw DefinitionCompilerTransportException::http($response->status());
        }

        $payload = $response->json();
        if (! is_array($payload)) {
            throw DefinitionCompilerTransportException::malformedResponse();
        }

        try {
            /** @var array<string, mixed> $payload */
            return DefinitionTestResultData::fromArray($payload);
        } catch (InvalidArgumentException $exception) {
            throw DefinitionCompilerTransportException::malformedResponse($exception);
        }
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
        $scheme = parse_url($url, PHP_URL_SCHEME);

        if (! filter_var($url, FILTER_VALIDATE_URL) || ! in_array($scheme, ['http', 'https'], true)) {
            throw DefinitionCompilerTransportException::configuration('The definition compiler URL must be an absolute HTTP or HTTPS URL.');
        }
        if (strlen($token) < 32 || trim($token) !== $token) {
            throw DefinitionCompilerTransportException::configuration('The definition compiler token must contain at least 32 bytes and no surrounding whitespace.');
        }
        if ($connectTimeout < 1 || $timeout < 1 || $connectTimeout > $timeout || $timeout > 30) {
            throw DefinitionCompilerTransportException::configuration('Definition compiler timeouts must be positive, bounded, and internally consistent.');
        }
        if ($attempts < 1 || $attempts > 3 || $retryDelay < 0 || $retryDelay > 2000) {
            throw DefinitionCompilerTransportException::configuration('Definition compiler retry settings exceed the supported bounds.');
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
}
