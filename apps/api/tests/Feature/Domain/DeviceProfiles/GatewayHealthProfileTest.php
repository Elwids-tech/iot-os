<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\DeviceProfiles;

use App\Domain\DeviceProfiles\Actions\PrepareGatewayHealthProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\PermissionRegistrar;
use Tests\TestCase;

final class GatewayHealthProfileTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private string $url;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->url = '/api/v1/organizations/'.$this->organization->uuid.'/device-profiles/gateway-health';
        $this->actingAs(User::where('email', 'shared.operator@example.test')->firstOrFail(), 'sanctum');
    }

    public function test_it_creates_and_publishes_once_and_later_calls_return_the_same_revision(): void
    {
        $first = $this->postJson($this->url)->assertCreated()->assertJsonPath('data.created', true)->json('data');
        $profile = DeviceProfile::where('uuid', $first['profile_uuid'])->firstOrFail();
        $this->assertSame([PrepareGatewayHealthProfile::CODE, 'Gateway health', 'gateways', 'published', 1], [$profile->code, $profile->name, $profile->category, $profile->status->value, $profile->revision]);
        $this->assertSame($profile->activeArtifact()->firstOrFail()->uuid, $first['artifact_uuid']);

        $this->postJson($this->url)->assertOk()->assertExactJson(['data' => [...$first, 'created' => false]]);
        $this->assertSame(1, DeviceProfile::where('code', PrepareGatewayHealthProfile::CODE)->count());
        $this->assertSame(1, $profile->artifacts()->count());
        $audit = DB::table('activity_log')->where('event', 'device_profile.gateway_health.created')->sole();
        $this->assertSame(1, json_decode($audit->properties, true)['revision']);
    }

    public function test_the_published_revision_carries_counters_the_enum_and_staleness(): void
    {
        $artifact = $this->postJson($this->url)->assertCreated()->json('data.artifact_uuid');
        $profile = DeviceProfile::where('code', PrepareGatewayHealthProfile::CODE)->firstOrFail();
        $parameters = collect($profile->artifacts()->where('uuid', $artifact)->firstOrFail()->definition['parameters'])->keyBy('key');

        $this->assertSame(PrepareGatewayHealthProfile::keys(), $parameters->keys()->all());
        foreach ($parameters as $key => $parameter) {
            $this->assertTrue($parameter['reports_state'], $key);
            $this->assertFalse($parameter['accepts_command'], $key);
            $this->assertSame(180, $parameter['reporting']['stale_after_seconds'], $key);
        }
        foreach (['uptime', 'reconnects'] as $key) {
            $this->assertSame(['counter', 'integer'], [$parameters[$key]['kind'], $parameters[$key]['data_type']]);
            $this->assertEquals(['monotonic' => true, 'reset_behavior' => 'new_segment'], $parameters[$key]['counter']);
        }
        $this->assertSame('s', $parameters['uptime']['unit']);
        $this->assertSame(['number', 'dBm'], [$parameters['signal_strength']['data_type'], $parameters['signal_strength']['unit']]);
        $this->assertSame('enum', $parameters['connection_type']['data_type']);
        $this->assertSame([['var' => 'value'], ['ethernet', 'wifi', 'cellular', 'other']], $parameters['connection_type']['validation']['rule']['in']);
        $this->assertNull($parameters['devices_online']['counter']);
    }

    public function test_an_edited_profile_is_returned_as_it_is(): void
    {
        $first = $this->postJson($this->url)->assertCreated()->json('data');
        $profile = DeviceProfile::where('uuid', $first['profile_uuid'])->firstOrFail();
        $profile->parameters()->where('key', 'reconnects')->update(['label' => 'Broker reconnects']);
        $profile->forceFill(['name' => 'Our gateway health', 'status' => 'draft', 'draft_revision' => 2])->save();
        $second = $this->postJson($this->url)->assertOk()->assertJsonPath('data.created', false)->json('data');
        $this->assertSame([$first['profile_uuid'], $first['artifact_uuid']], [$second['profile_uuid'], $second['artifact_uuid']]);
        $this->assertSame('Our gateway health', $profile->fresh()->name);
        $this->assertSame('Broker reconnects', $profile->parameters()->where('key', 'reconnects')->value('label'));
    }

    public function test_a_profile_with_the_code_but_no_published_revision_returns_no_artifact(): void
    {
        $user = User::where('email', 'shared.operator@example.test')->firstOrFail();
        $draft = DeviceProfile::create(['organization_id' => $this->organization->id, 'code' => PrepareGatewayHealthProfile::CODE, 'name' => 'Draft health', 'created_by' => $user->id, 'updated_by' => $user->id]);
        $this->postJson($this->url)->assertOk()->assertExactJson(['data' => ['profile_uuid' => $draft->uuid, 'artifact_uuid' => null, 'created' => false]]);

        // A deleted draft still holds the code, so it is removed before the profile is created.
        $draft->delete();
        $created = $this->postJson($this->url)->assertCreated()->json('data');
        $this->assertNotSame($draft->uuid, $created['profile_uuid']);
        $this->assertNull(DeviceProfile::withTrashed()->where('uuid', $draft->uuid)->first());
    }

    public function test_missing_permissions_get_403(): void
    {
        $this->actingAs(User::where('email', 'acme.member@example.test')->firstOrFail(), 'sanctum');
        $this->postJson($this->url)->assertForbidden();

        $author = User::factory()->create();
        $this->organization->users()->attach($author->id);
        app(PermissionRegistrar::class)->setPermissionsTeamId($this->organization->id);
        $author->givePermissionTo('DeviceProfile.create');
        $this->actingAs($author, 'sanctum');
        $this->postJson($this->url)->assertForbidden();
        $this->assertFalse(DeviceProfile::where('code', PrepareGatewayHealthProfile::CODE)->exists());
    }

    public function test_another_organizations_profile_is_never_returned(): void
    {
        $this->actingAs(User::where('is_super_admin', true)->firstOrFail(), 'sanctum');
        $acme = $this->postJson($this->url)->assertCreated()->json('data');
        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $other = $this->postJson('/api/v1/organizations/'.$northstar->uuid.'/device-profiles/gateway-health')->assertCreated()->json('data');
        $this->assertNotSame($acme['profile_uuid'], $other['profile_uuid']);
        $this->assertSame($northstar->id, DeviceProfile::where('uuid', $other['profile_uuid'])->value('organization_id'));
    }

    public function test_the_parameter_keys_are_the_sdk_health_metric_names(): void
    {
        $header = file_get_contents(config('firmware.path').'/sdk/include/iotos/iotos_health.h');
        preg_match_all('/^#define IOTOS_HEALTH_[A-Z_]+ "([a-z_]+)"/m', $header, $matches);
        $this->assertCount(8, $matches[1]);
        $this->assertSame($matches[1], PrepareGatewayHealthProfile::keys());
    }
}
