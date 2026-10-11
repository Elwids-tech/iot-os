<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices;

use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

final class RuntimeReliabilityTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actingAs(User::where('email', 'super-admin@example.test')->firstOrFail(), 'sanctum');
        config(['devices.runtime_token' => str_repeat('t', 40), 'devices.runtime_url' => 'http://runtime:8081']);
        Http::fake(['http://runtime:8081/*' => Http::response(['valid' => true])]);
    }

    private function runtimeEvent(string $uuid, string $type, array $payload)
    {
        return $this->withToken(str_repeat('t', 40))->postJson('/api/internal/devices/events', ['uuid' => $uuid, 'type' => $type, 'payload' => $payload]);
    }

    public function test_events_about_deleted_records_are_acknowledged_instead_of_retried(): void
    {
        $connectionEvent = (string) Str::uuid();
        $this->runtimeEvent($connectionEvent, 'connection.presence.v1', ['connection_uuid' => (string) Str::uuid(), 'presence' => 'online'])
            ->assertOk()->assertJsonPath('ignored', 'unknown_reference');
        $this->runtimeEvent($connectionEvent, 'connection.presence.v1', ['connection_uuid' => (string) Str::uuid(), 'presence' => 'online'])
            ->assertOk()->assertJsonPath('duplicate', true);

        $this->runtimeEvent((string) Str::uuid(), 'device.presence.v1', ['device_uuid' => (string) Str::uuid(), 'organization_uuid' => $this->organization->uuid, 'presence' => 'online'])
            ->assertOk()->assertJsonPath('ignored', 'unknown_reference');
        $this->runtimeEvent((string) Str::uuid(), 'retention.cleanup.v1', ['organization_uuid' => (string) Str::uuid(), 'status' => 'completed'])
            ->assertOk()->assertJsonPath('ignored', 'unknown_reference');
        $this->assertSame(3, DB::table('device_inbox')->count());
    }

    public function test_state_snapshot_uses_a_fixed_number_of_queries(): void
    {
        $register = fn (string $code) => $this->postJson('/api/v1/organizations/'.$this->organization->uuid.'/devices', ['name' => $code, 'code' => $code])->assertCreated();
        $queries = function (): int {
            DB::flushQueryLog();
            DB::enableQueryLog();
            $this->withToken(str_repeat('t', 40))->getJson('/api/internal/devices/state')->assertOk();
            DB::disableQueryLog();

            return count(DB::getQueryLog());
        };
        $register('meter-1');
        $register('meter-2');
        $few = $queries();
        foreach (range(3, 8) as $n) {
            $register('meter-'.$n);
        }
        $this->assertSame($few, $queries());
        $this->withToken(str_repeat('t', 40))->getJson('/api/internal/devices/state')
            ->assertJsonCount(8, 'devices')->assertJsonPath('devices.0.organization_uuid', $this->organization->uuid);
    }

    public function test_ledgers_are_pruned_outside_the_redelivery_window(): void
    {
        $row = fn (?string $published = null, string $created = '-1 day') => ['uuid' => (string) Str::uuid(), 'type' => 'device.activate.v1', 'payload' => '{}',
            'created_at' => now()->modify($created), 'published_at' => $published ? now()->modify($published) : null];
        $expired = $row('-9 days', '-9 days');
        $recent = $row('-1 day');
        $unpublished = $row(null, '-30 days');
        DB::table('device_outbox')->insert([$expired, $recent, $unpublished]);
        DB::table('device_inbox')->insert([
            ['uuid' => $old = (string) Str::uuid(), 'type' => 'runtime.heartbeat.v1', 'received_at' => now()->subDays(9)],
            ['uuid' => $new = (string) Str::uuid(), 'type' => 'runtime.heartbeat.v1', 'received_at' => now()->subDay()],
        ]);

        $this->artisan('devices:prune-ledgers')->expectsOutput('Pruned 1 published outbox events and 1 inbox entries.')->assertSuccessful();

        $this->assertEqualsCanonicalizing([$recent['uuid'], $unpublished['uuid']], DB::table('device_outbox')->pluck('uuid')->all());
        $this->assertSame([$new], DB::table('device_inbox')->pluck('uuid')->all());
        $this->assertNotContains($old, DB::table('device_inbox')->pluck('uuid')->all());
    }
}
