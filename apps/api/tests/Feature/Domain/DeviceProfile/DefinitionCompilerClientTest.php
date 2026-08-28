<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\DeviceProfile;

use App\Domain\DeviceProfile\Data\DeviceProfileAuthoringData;
use App\Domain\DeviceProfile\Data\NativeMqttBindingAuthoringData;
use App\Domain\DeviceProfile\Exceptions\DefinitionCompilerTransportException;
use App\Domain\DeviceProfile\Services\DefinitionCompilerClient;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use JsonException;
use Tests\TestCase;

final class DefinitionCompilerClientTest extends TestCase
{
    private const INTERNAL_TOKEN = 'test-runtime-internal-token-00000001';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('services.iot_runtime', [
            'url' => 'http://runtime.test:8081',
            'token' => self::INTERNAL_TOKEN,
            'connect_timeout_seconds' => 1,
            'timeout_seconds' => 3,
            'attempts' => 2,
            'retry_delay_milliseconds' => 0,
        ]);
        Http::preventStrayRequests();
    }

    /** @throws JsonException */
    public function test_it_returns_a_valid_typed_compile_result_and_sends_the_contract_request(): void
    {
        Http::fake([
            'http://runtime.test:8081/internal/v1/definitions/compile' => Http::response($this->preview(valid: true)),
        ]);

        $result = app(DefinitionCompilerClient::class)->compile(
            DeviceProfileAuthoringData::fromArray($this->fixture('profile.json')),
            NativeMqttBindingAuthoringData::fromArray($this->fixture('binding.json')),
            [$this->telemetryFixture()],
        );

        $this->assertTrue($result->valid);
        $this->assertSame(str_repeat('a', 64), $result->profileArtifactHash);
        $this->assertSame(str_repeat('b', 64), $result->bindingArtifactHash);
        Http::assertSentCount(1);
        Http::assertSent(function (Request $request): bool {
            $payload = $request->data();

            return $request->url() === 'http://runtime.test:8081/internal/v1/definitions/compile'
                && $request->hasHeader('Authorization', 'Bearer '.self::INTERNAL_TOKEN)
                && $request->hasHeader('Accept', 'application/json')
                && ($payload['schema'] ?? null) === 'iot.definition-compile-request.v1'
                && ($payload['profile']['schema'] ?? null) === 'iot.device-profile.authoring.v1'
                && ($payload['binding']['schema'] ?? null) === 'iot.native-mqtt-binding.authoring.v1'
                && count($payload['fixtures'] ?? []) === 1;
        });
    }

    /** @throws JsonException */
    public function test_domain_invalid_result_is_returned_without_a_transport_exception(): void
    {
        Http::fake(['*' => Http::response($this->preview(valid: false), 200)]);

        $result = app(DefinitionCompilerClient::class)->compile(
            DeviceProfileAuthoringData::fromArray($this->fixture('profile.json')),
            NativeMqttBindingAuthoringData::fromArray($this->fixture('binding.json')),
            [$this->telemetryFixture()],
        );

        $this->assertFalse($result->valid);
        $this->assertSame('INVALID_CEL', $result->diagnostics[0]['code']);
        $this->assertNull($result->profileArtifact);
        $this->assertNull($result->bindingArtifact);
        Http::assertSentCount(1);
    }

    /** @throws JsonException */
    public function test_unauthorized_response_fails_without_retrying(): void
    {
        Http::fake(['*' => Http::response(['error' => ['code' => 'unauthorized']], 401)]);

        try {
            app(DefinitionCompilerClient::class)->compile(
                DeviceProfileAuthoringData::fromArray($this->fixture('profile.json')),
                NativeMqttBindingAuthoringData::fromArray($this->fixture('binding.json')),
                [$this->telemetryFixture()],
            );
            $this->fail('Expected a transport exception.');
        } catch (DefinitionCompilerTransportException $exception) {
            $this->assertSame(401, $exception->statusCode);
        }

        Http::assertSentCount(1);
    }

    /** @throws JsonException */
    public function test_server_failure_is_retried_within_the_configured_bound(): void
    {
        Http::fakeSequence()->pushStatus(500)->pushStatus(503);

        try {
            app(DefinitionCompilerClient::class)->compile(
                DeviceProfileAuthoringData::fromArray($this->fixture('profile.json')),
                NativeMqttBindingAuthoringData::fromArray($this->fixture('binding.json')),
                [$this->telemetryFixture()],
            );
            $this->fail('Expected a transport exception.');
        } catch (DefinitionCompilerTransportException $exception) {
            $this->assertSame(503, $exception->statusCode);
        }

        Http::assertSentCount(2);
    }

    /** @throws JsonException */
    public function test_connection_failure_is_wrapped_after_bounded_retries(): void
    {
        Http::fake(['*' => Http::failedConnection('simulated timeout')]);

        $this->expectException(DefinitionCompilerTransportException::class);
        $this->expectExceptionMessage('could not be reached');

        try {
            app(DefinitionCompilerClient::class)->compile(
                DeviceProfileAuthoringData::fromArray($this->fixture('profile.json')),
                NativeMqttBindingAuthoringData::fromArray($this->fixture('binding.json')),
                [$this->telemetryFixture()],
            );
        } finally {
            Http::assertSentCount(2);
        }
    }

    /** @throws JsonException */
    public function test_malformed_success_response_is_wrapped_as_a_transport_failure(): void
    {
        $malformedPreview = $this->preview(valid: true);
        $malformedPreview['artifact_hashes']['profile'] = null;
        Http::fake(['*' => Http::response($malformedPreview, 200)]);

        $this->expectException(DefinitionCompilerTransportException::class);
        $this->expectExceptionMessage('malformed response');

        app(DefinitionCompilerClient::class)->compile(
            DeviceProfileAuthoringData::fromArray($this->fixture('profile.json')),
            NativeMqttBindingAuthoringData::fromArray($this->fixture('binding.json')),
            [$this->telemetryFixture()],
        );
    }

    /** @return array<string, mixed> */
    private function preview(bool $valid): array
    {
        return [
            'schema' => 'iot.definition-preview.v1',
            'valid' => $valid,
            'input_hash' => str_repeat('c', 64),
            'compiler' => [
                'name' => 'iot-definition-compiler',
                'version' => '1.0.0',
                'cel_environment' => 'cel-go-v0.26-restricted-v1',
                'jsonpath_version' => 'ojg-v1-restricted-v1',
                'unit_registry' => 'ucum-v1',
            ],
            'diagnostics' => $valid ? [] : [[
                'severity' => 'error',
                'code' => 'INVALID_CEL',
                'path' => '/profile/version/components',
                'message' => 'Invalid expression.',
            ]],
            'profile_artifact' => $valid ? ['schema' => 'iot.device-profile.v1'] : null,
            'binding_artifact' => $valid ? ['schema' => 'iot.native-mqtt-binding.v1'] : null,
            'artifact_hashes' => [
                'profile' => $valid ? str_repeat('a', 64) : null,
                'binding' => $valid ? str_repeat('b', 64) : null,
            ],
            'previews' => [],
        ];
    }

    /**
     * @return array<string, mixed>
     *
     * @throws JsonException
     */
    private function fixture(string $name): array
    {
        $path = base_path("../../contracts/fixtures/device-onboarding/valid/temperature-humidity-thermostat/{$name}");
        $contents = file_get_contents($path);
        $this->assertNotFalse($contents);

        return json_decode($contents, true, flags: JSON_THROW_ON_ERROR);
    }

    /**
     * @return array<string, mixed>
     *
     * @throws JsonException
     */
    private function telemetryFixture(): array
    {
        return [
            'name' => 'temperature and humidity telemetry',
            'kind' => 'telemetry',
            'input' => $this->fixture('telemetry-payload.json'),
        ];
    }
}
