<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\DeviceProfile;

use App\Domain\DeviceManagement\Data\GatewayAuthoringData;
use App\Domain\DeviceManagement\Data\GatewayRouteAuthoringData;
use App\Domain\DeviceProfile\Data\DefinitionCompileResultData;
use App\Domain\DeviceProfile\Data\DeviceProfileAuthoringData;
use App\Domain\DeviceProfile\Data\NativeMqttBindingAuthoringData;
use App\Domain\DeviceProfile\Exceptions\DefinitionCompilerAuthenticationException;
use App\Domain\DeviceProfile\Exceptions\DefinitionCompilerTransportException;
use App\Domain\DeviceProfile\Services\DefinitionCompilerClient;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use JsonException;
use Tests\TestCase;

final class DefinitionCompilerClientTest extends TestCase
{
    private const INTERNAL_TOKEN = 'test-runtime-internal-token-00000001';

    private const ORGANIZATION_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('services.iot_runtime', [
            'url' => 'http://runtime.test:8081',
            'token' => self::INTERNAL_TOKEN,
            'connect_timeout_seconds' => 1,
            'timeout_seconds' => 2,
            'attempts' => 2,
            'retry_delay_milliseconds' => 0,
        ]);
        Http::preventStrayRequests();
    }

    /** @throws JsonException */
    public function test_it_sends_the_complete_route_aware_contract_and_returns_a_typed_result(): void
    {
        Http::fake([
            'http://runtime.test:8081/internal/v1/definitions/compile' => Http::response($this->preview(valid: true)),
        ]);

        $result = $this->compile();

        $this->assertTrue($result->valid);
        $this->assertSame('iot.definition-preview.v1', $result->schema);
        $this->assertSame(str_repeat('c', 64), $result->inputHash);
        $this->assertSame(str_repeat('f', 64), $result->artifactHashes['runtime_bundle']);
        Http::assertSent(function (Request $request): bool {
            $payload = $request->data();

            return $request->url() === 'http://runtime.test:8081/internal/v1/definitions/compile'
                && $request->hasHeader('Authorization', 'Bearer '.self::INTERNAL_TOKEN)
                && $payload['schema'] === 'iot.definition-compile-request.v1'
                && $payload['organization_uuid'] === self::ORGANIZATION_UUID
                && $payload['profile']['schema'] === 'iot.device-profile.authoring.v1'
                && $payload['binding']['schema'] === 'iot.native-mqtt-binding.authoring.v1'
                && $payload['gateway']['gateway']['uuid'] === '30000000-0000-4000-8000-000000000001'
                && $payload['route']['route']['device_uuid'] === '40000000-0000-4000-8000-000000000002'
                && $payload['fixtures'] === [];
        });
    }

    /** @throws JsonException */
    public function test_domain_diagnostics_are_returned_without_a_transport_exception(): void
    {
        Http::fake(['*' => Http::response($this->preview(valid: false))]);

        $result = $this->compile();

        $this->assertFalse($result->valid);
        $this->assertSame('DERIVATION_CYCLE', $result->diagnostics[0]['code']);
        $this->assertNull($result->artifactHashes['profile']);
        Http::assertSentCount(1);
    }

    /** @throws JsonException */
    public function test_authentication_failure_is_distinct_and_is_not_retried(): void
    {
        Http::fake(['*' => Http::response(['error' => ['code' => 'unauthorized']], 401)]);

        try {
            $this->compile();
            $this->fail('Expected compiler authentication failure.');
        } catch (DefinitionCompilerAuthenticationException $exception) {
            $this->assertSame(401, $exception->statusCode);
        }

        Http::assertSentCount(1);
    }

    /** @throws JsonException */
    public function test_server_failure_is_bounded_and_reported_as_transport_failure(): void
    {
        Http::fakeSequence()->pushStatus(500)->pushStatus(503);

        try {
            $this->compile();
            $this->fail('Expected compiler transport failure.');
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
        try {
            $this->compile();
        } finally {
            Http::assertSentCount(2);
        }
    }

    /** @throws JsonException */
    public function test_malformed_success_response_is_a_transport_failure(): void
    {
        $preview = $this->preview(valid: true);
        $preview['input_hash'] = 'not-a-hash';
        Http::fake(['*' => Http::response($preview)]);

        $this->expectException(DefinitionCompilerTransportException::class);
        $this->compile();
    }

    /** @throws JsonException */
    private function compile(): DefinitionCompileResultData
    {
        return app(DefinitionCompilerClient::class)->compile(
            self::ORGANIZATION_UUID,
            DeviceProfileAuthoringData::fromArray($this->fixture('humidity-profile.json')),
            NativeMqttBindingAuthoringData::fromArray($this->fixture('humidity-binding.json')),
            GatewayAuthoringData::fromArray($this->fixture('gateway.json')),
            GatewayRouteAuthoringData::fromArray($this->fixture('humidity-route.json')),
            [],
        );
    }

    /** @return array<string, mixed> */
    private function preview(bool $valid): array
    {
        $preview = [
            'schema' => 'iot.definition-preview.v1',
            'valid' => $valid,
            'input_hash' => str_repeat('c', 64),
            'compiler' => [
                'name' => 'iot-os-definition-compiler',
                'version' => '1.0.0',
                'cel_environment' => 'cel-go-v0.26-restricted-v1',
                'jsonpath_version' => 'ojg-v1-restricted-v1',
                'unit_registry' => 'ucum-essence-2026',
            ],
            'diagnostics' => $valid ? [] : [[
                'severity' => 'error',
                'code' => 'DERIVATION_CYCLE',
                'path' => '/profile/version/derived_parameters',
                'message' => 'Derived parameter dependencies contain a cycle.',
            ]],
            'artifact_hashes' => [
                'profile' => $valid ? str_repeat('a', 64) : null,
                'binding' => $valid ? str_repeat('b', 64) : null,
                'runtime_bundle' => $valid ? str_repeat('f', 64) : null,
            ],
            'previews' => [],
        ];

        if ($valid) {
            $preview['profile_artifact'] = ['schema' => 'iot.device-profile.v1'];
            $preview['binding_artifact'] = ['schema' => 'iot.native-mqtt-binding.v1'];
            $preview['runtime_bundle'] = [
                'schema' => 'iot.runtime-bundle.v1',
                'runtime_bundle_hash' => str_repeat('f', 64),
            ];
        }

        return $preview;
    }

    /**
     * @return array<string, mixed>
     *
     * @throws JsonException
     */
    private function fixture(string $name): array
    {
        $path = base_path("../../contracts/fixtures/device-onboarding/valid/hub-fanout/{$name}");

        return json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
    }
}
