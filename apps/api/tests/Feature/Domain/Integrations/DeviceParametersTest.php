<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Integrations;

use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceConfiguration;
use App\Domain\Devices\Models\Site;
use App\Domain\Integrations\Models\IntegrationApplication;
use App\Domain\Shared\Models\Organization;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Tests\TestCase;

/** The device read carries its profile, site and parameters (spec 030, US4, FR-014); the list is unchanged. */
final class DeviceParametersTest extends TestCase
{
    use RefreshDatabase;

    private Organization $org;

    private Site $site;

    private Device $device;

    private Device $bare;

    private DeviceProfile $profile;

    private DeviceProfileArtifact $artifact;

    /** @var list<array<string, mixed>> */
    private array $parameters;

    private IntegrationApplication $application;

    private string $read;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->site = Site::create(['organization_id' => $this->org->id, 'name' => 'Packaging hall', 'timezone' => 'Asia/Colombo']);
        $this->parameters = [
            ['uuid' => (string) Str::uuid(), 'key' => 'vibration', 'label' => 'Vibration', 'kind' => 'measurement', 'data_type' => 'number', 'unit' => 'mm/s', 'display' => ['precision' => 1], 'reports_state' => true, 'accepts_command' => false, 'format' => null],
            ['uuid' => (string) Str::uuid(), 'key' => 'setpoint', 'label' => 'Speed setpoint', 'kind' => 'state', 'data_type' => 'integer', 'unit' => 'rpm', 'display' => [], 'reports_state' => true, 'accepts_command' => true, 'format' => null],
        ];
        $this->profile = DeviceProfile::create(['organization_id' => $this->org->id, 'code' => 'pump', 'name' => 'Pump']);
        $definition = ['profile' => ['name' => 'Pump'], 'parameters' => $this->parameters];
        $this->artifact = DeviceProfileArtifact::create(['device_profile_id' => $this->profile->id, 'revision' => 3, 'definition' => $definition, 'definition_hash' => hash('sha256', json_encode($definition)), 'status' => 'active', 'compiled_at' => now()]);
        $this->device = Device::create(['organization_id' => $this->org->id, 'site_id' => $this->site->id, 'code' => 'P-201', 'name' => 'Filler pump P-201', 'lifecycle' => 'active']);
        $this->bare = Device::create(['organization_id' => $this->org->id, 'code' => 'bare', 'name' => 'No profile yet']);
        $this->application = IntegrationApplication::create(['organization_id' => $this->org->id, 'name' => 'Twin', 'abilities' => ['devices:read'], 'device_uuids' => [$this->device->uuid, $this->bare->uuid]])->fresh();
        $this->read = '/api/integration/v1/organizations/'.$this->org->uuid;
    }

    private function configure(Device $device, bool $applied = true): DeviceConfiguration
    {
        $configuration = DeviceConfiguration::create(['device_id' => $device->id, 'device_profile_artifact_id' => $this->artifact->id, 'revision' => 1, 'definition_hash' => $this->artifact->definition_hash,
            'definition' => ['profile_canonical_json' => json_encode($this->artifact->definition), 'mappings' => []], 'created_at' => now()]);
        $device->update($applied ? ['applied_configuration_uuid' => $configuration->uuid, 'last_applied_configuration_uuid' => $configuration->uuid] : ['last_applied_configuration_uuid' => $configuration->uuid]);

        return $configuration;
    }

    private function token(array $abilities = ['devices:read']): string
    {
        $secret = Str::random(40);
        $token = $this->application->tokens()->create(['name' => 'test', 'token' => hash('sha256', $secret), 'abilities' => $abilities, 'expires_at' => now()->addDay()]);

        return $token->id.'|'.$secret;
    }

    private function api(string $token, string $path)
    {
        Auth::forgetGuards();

        return $this->withToken($token)->getJson($path);
    }

    public function test_the_device_read_carries_profile_site_and_parameters(): void
    {
        $this->configure($this->device);
        $token = $this->token();
        $data = $this->api($token, $this->read.'/devices/'.$this->device->uuid)->assertOk()->json('data');
        $this->assertSame(['uuid' => $this->profile->uuid, 'name' => 'Pump', 'revision' => 3], $data['profile']);
        $this->assertSame(['uuid' => $this->site->uuid, 'name' => 'Packaging hall', 'timezone' => 'Asia/Colombo'], $data['site']);
        $this->assertSame([
            ['uuid' => $this->parameters[0]['uuid'], 'key' => 'vibration', 'name' => 'Vibration', 'unit' => 'mm/s', 'data_type' => 'number', 'decimals' => 1, 'accepts_command' => false, 'reports_state' => true],
            ['uuid' => $this->parameters[1]['uuid'], 'key' => 'setpoint', 'name' => 'Speed setpoint', 'unit' => 'rpm', 'data_type' => 'integer', 'decimals' => null, 'accepts_command' => true, 'reports_state' => true],
        ], $data['parameters']);
        $this->assertSame('P-201', $data['code']);
        $this->assertSame('unseen', $data['presence']);
        // The list stays as it is: no profile, site or parameters on its items.
        $this->api($token, $this->read.'/devices')->assertOk()->assertJsonPath('meta.total', 2)
            ->assertJsonMissingPath('data.0.parameters')->assertJsonMissingPath('data.0.profile')->assertJsonMissingPath('data.0.site');
    }

    public function test_a_device_without_a_profile_revision_or_site_carries_empty_parameters_and_nulls(): void
    {
        $token = $this->token();
        $this->api($token, $this->read.'/devices/'.$this->bare->uuid)->assertOk()
            ->assertJsonPath('data.profile', null)->assertJsonPath('data.site', null)->assertJsonPath('data.parameters', []);
        // The last configuration the runtime confirmed counts when none is applied right now.
        $this->configure($this->bare, applied: false);
        $this->api($token, $this->read.'/devices/'.$this->bare->uuid)->assertOk()
            ->assertJsonPath('data.profile.revision', 3)->assertJsonPath('data.parameters.0.key', 'vibration')->assertJsonPath('data.site', null);
    }

    public function test_a_foreign_or_ungranted_device_is_not_found_and_the_ability_is_required(): void
    {
        $this->configure($this->device);
        $other = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $foreign = Device::create(['organization_id' => $other->id, 'code' => 'foreign', 'name' => 'Foreign']);
        $this->configure($foreign);
        $token = $this->token();
        $this->api($token, $this->read.'/devices/'.$foreign->uuid)->assertNotFound();
        $this->api($token, '/api/integration/v1/organizations/'.$other->uuid.'/devices/'.$foreign->uuid)->assertNotFound();
        $ungranted = Device::create(['organization_id' => $this->org->id, 'code' => 'private', 'name' => 'Private']);
        $this->api($token, $this->read.'/devices/'.$ungranted->uuid)->assertNotFound();
        $this->application->update(['abilities' => ['devices:read', 'alerts:read']]);
        $this->api($this->token(['alerts:read']), $this->read.'/devices/'.$this->device->uuid)->assertForbidden();
    }
}
