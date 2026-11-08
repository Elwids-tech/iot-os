<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Integrations;

use App\Domain\Devices\Models\Device;
use App\Domain\Integrations\Models\IntegrationApplication;
use App\Domain\Shared\Models\Organization;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * The batch latest read of spec 030 (US1): one request answers the latest values of
 * up to 100 granted devices with the device read's presence and last-seen time.
 */
final class LatestBatchTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private Organization $otherOrganization;

    /** Online, with an applied configuration and a fresh runtime heartbeat. */
    private Device $online;

    /** Reported online once, but the runtime has not been seen for a minute. */
    private Device $staleRuntime;

    /** Registered, never activated, never seen. */
    private Device $never;

    /** Of the organization, but not granted to the application. */
    private Device $ungranted;

    private Device $foreign;

    private string $token;

    private string $path;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->otherOrganization = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        config(['devices.runtime_token' => 'test', 'devices.runtime_url' => 'http://runtime']);
        $this->online = Device::create(['organization_id' => $this->organization->id, 'code' => 'P-201', 'name' => 'Filler pump P-201',
            'presence' => 'online', 'runtime_seen_at' => now(), 'last_seen_at' => now()->subSeconds(5),
            'applied_configuration_uuid' => (string) Str::uuid(), 'last_applied_configuration_uuid' => (string) Str::uuid()]);
        $this->staleRuntime = Device::create(['organization_id' => $this->organization->id, 'code' => 'P-202', 'name' => 'Filler pump P-202',
            'presence' => 'online', 'runtime_seen_at' => now()->subMinute(), 'last_seen_at' => now()->subMinutes(2),
            'last_applied_configuration_uuid' => (string) Str::uuid()]);
        $this->never = Device::create(['organization_id' => $this->organization->id, 'code' => 'P-203', 'name' => 'Filler pump P-203']);
        $this->ungranted = Device::create(['organization_id' => $this->organization->id, 'code' => 'P-204', 'name' => 'Filler pump P-204']);
        $this->foreign = Device::create(['organization_id' => $this->otherOrganization->id, 'code' => 'N-1', 'name' => 'Northstar meter']);
        $application = IntegrationApplication::create(['organization_id' => $this->organization->id, 'name' => 'Twin',
            'abilities' => ['telemetry:read'], 'device_uuids' => [$this->online->uuid, $this->staleRuntime->uuid, $this->never->uuid]])->fresh();
        $secret = Str::random(40);
        $token = $application->tokens()->create(['name' => 'twin', 'token' => hash('sha256', $secret), 'abilities' => ['telemetry:read'], 'expires_at' => now()->addDay()]);
        $this->token = $token->id.'|'.$secret;
        $this->path = '/api/integration/v1/organizations/'.$this->organization->uuid.'/telemetry/latest/query';
    }

    /**
     * @param  list<string>  $uuids
     */
    private function batch(array $uuids): TestResponse
    {
        Auth::forgetGuards();

        return $this->withToken($this->token)->postJson($this->path, ['device_uuids' => $uuids]);
    }

    public function test_entries_follow_the_request_order_with_the_device_reads_presence_and_last_seen_time(): void
    {
        $reading = ['parameter_uuid' => (string) Str::uuid(), 'key' => 'vibration', 'label' => 'Vibration', 'data_type' => 'number', 'unit' => 'mm/s',
            'value' => 1.8, 'quality' => 'good', 'observed_at' => '2026-11-07T09:41:57Z', 'received_at' => '2026-11-07T09:41:58Z',
            'last_valid_received_at' => '2026-11-07T09:41:58Z', 'timestamp_source' => 'source', 'historical' => false, 'internal_secret' => 'hidden', 'diagnostic' => 'runtime only'];
        $runtimeConfiguration = (string) Str::uuid();
        Http::fake(['*/internal/measurements/latest-batch*' => Http::response(['data' => [
            $this->online->uuid => ['data' => [$reading], 'presence' => 'online', 'configuration_uuid' => $runtimeConfiguration],
            $this->staleRuntime->uuid => ['data' => [], 'presence' => 'unknown', 'processing' => 'inactive'],
        ]])]);

        $response = $this->batch([$this->staleRuntime->uuid, $this->online->uuid, $this->never->uuid])->assertOk()
            ->assertJsonPath('schema_version', 'telemetry-latest-batch.v1')
            ->assertJsonPath('data.0.device_uuid', $this->staleRuntime->uuid)
            ->assertJsonPath('data.1.device_uuid', $this->online->uuid)
            ->assertJsonPath('data.2.device_uuid', $this->never->uuid)
            ->assertJsonMissing(['internal_secret' => 'hidden'])->assertJsonMissing(['diagnostic' => 'runtime only'])->assertJsonMissing(['processing' => 'inactive']);
        $data = $response->json('data');
        $this->assertCount(3, $data);

        // Presence and last_seen_at are the device read's: the runtime's own word is not used.
        $this->assertSame('unknown', $data[0]['presence'], 'online with a runtime unseen for a minute is unknown');
        $this->assertSame($this->staleRuntime->last_applied_configuration_uuid, $data[0]['configuration_uuid']);
        $this->assertSame([], $data[0]['readings']);
        $this->assertSame($this->staleRuntime->fresh()->last_seen_at->toJSON(), $data[0]['last_seen_at']);

        $this->assertSame('online', $data[1]['presence']);
        $this->assertSame($runtimeConfiguration, $data[1]['configuration_uuid']);
        $this->assertSame($this->online->fresh()->last_seen_at->toJSON(), $data[1]['last_seen_at']);
        $this->assertSame(['parameter_uuid', 'key', 'label', 'data_type', 'unit', 'value', 'quality', 'observed_at', 'received_at', 'last_valid_received_at', 'timestamp_source', 'historical'], array_keys($data[1]['readings'][0]));
        $this->assertSame(1.8, $data[1]['readings'][0]['value']);

        // A device that never reported has no readings and no configuration, never zeros.
        $this->assertSame(['device_uuid' => $this->never->uuid, 'configuration_uuid' => null, 'presence' => 'unseen', 'last_seen_at' => null, 'readings' => []], $data[2]);

        Http::assertSentCount(1);
        Http::assertSent(fn ($request) => $request['organization_uuid'] === $this->organization->uuid
            && $request['devices'] === implode(',', [$this->staleRuntime->uuid, $this->online->uuid, $this->never->uuid]));
    }

    public function test_a_device_outside_the_grant_refuses_the_whole_request(): void
    {
        Http::fake();
        $this->batch([$this->online->uuid, $this->ungranted->uuid])->assertNotFound();
        $this->batch([$this->online->uuid, $this->foreign->uuid])->assertNotFound();
        $this->batch([(string) Str::uuid()])->assertNotFound();
        Http::assertNothingSent();
    }

    public function test_more_than_100_devices_a_repeat_or_a_malformed_uuid_is_invalid_input(): void
    {
        Http::fake();
        $many = array_map(static fn (): string => (string) Str::uuid(), range(1, 101));
        $this->batch($many)->assertUnprocessable()->assertJsonValidationErrors(['device_uuids'])
            ->assertSeeText('100');
        $this->batch([$this->online->uuid, $this->online->uuid])->assertUnprocessable()->assertJsonValidationErrors(['device_uuids.0']);
        $this->batch(['not-a-uuid'])->assertUnprocessable()->assertJsonValidationErrors(['device_uuids.0']);
        $this->batch([])->assertUnprocessable()->assertJsonValidationErrors(['device_uuids']);
        Http::assertNothingSent();
    }

    public function test_a_failing_runtime_is_service_unavailable_never_an_empty_answer(): void
    {
        Http::fake(['*/internal/measurements/latest-batch*' => Http::response([], 503)]);
        $this->batch([$this->online->uuid])->assertStatus(503);
    }
}
