<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Integrations;

use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\Site;
use App\Domain\Integrations\Models\IntegrationApplication;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Tests\TestCase;

/** Sites for applications under `entities:read` (spec 030, US4, FR-015), counting the resolved grant. */
final class SitesReadTest extends TestCase
{
    use RefreshDatabase;

    private Organization $org;

    private Organization $other;

    private Site $hall;

    private Site $yard;

    /** @var list<Device> two at the hall, one at the yard, one without a site */
    private array $devices;

    private string $read;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->other = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        // Named so the order by name differs from the order of creation.
        $this->yard = Site::create(['organization_id' => $this->org->id, 'name' => 'Yard', 'timezone' => 'UTC']);
        $this->hall = Site::create(['organization_id' => $this->org->id, 'name' => 'Packaging hall', 'timezone' => 'Asia/Colombo', 'address' => 'Example Road 1', 'latitude' => 6.9, 'longitude' => 79.8]);
        Site::create(['organization_id' => $this->other->id, 'name' => 'Foreign plant', 'timezone' => 'UTC']);
        $this->devices = [
            Device::create(['organization_id' => $this->org->id, 'site_id' => $this->hall->id, 'code' => 'h1', 'name' => 'Hall 1']),
            Device::create(['organization_id' => $this->org->id, 'site_id' => $this->hall->id, 'code' => 'h2', 'name' => 'Hall 2']),
            Device::create(['organization_id' => $this->org->id, 'site_id' => $this->yard->id, 'code' => 'y1', 'name' => 'Yard 1']),
            Device::create(['organization_id' => $this->org->id, 'code' => 'loose', 'name' => 'Loose']),
        ];
        $this->read = '/api/integration/v1/organizations/'.$this->org->uuid;
    }

    private function application(array $grant, array $abilities = ['entities:read', 'devices:read']): IntegrationApplication
    {
        return IntegrationApplication::create(['organization_id' => $this->org->id, 'name' => 'Twin', 'abilities' => $abilities, 'device_uuids' => [], 'site_uuids' => [], ...$grant])->fresh();
    }

    private function token(IntegrationApplication $application, array $abilities = ['entities:read', 'devices:read']): string
    {
        $secret = Str::random(40);
        $token = $application->tokens()->create(['name' => 'test', 'token' => hash('sha256', $secret), 'abilities' => $abilities, 'expires_at' => now()->addDay()]);

        return $token->id.'|'.$secret;
    }

    private function api(string $token, string $path)
    {
        Auth::forgetGuards();

        return $this->withToken($token)->getJson($path);
    }

    public function test_every_site_is_listed_by_name_with_the_granted_device_count(): void
    {
        [$h1, , $y1, $loose] = $this->devices;
        $listed = $this->application(['device_uuids' => [$h1->uuid, $loose->uuid]]);
        $data = $this->api($this->token($listed), $this->read.'/sites')->assertOk()->json('data');
        $this->assertSame(['Packaging hall', 'Yard'], array_column($data, 'name'));
        $this->assertSame(['uuid' => $this->hall->uuid, 'name' => 'Packaging hall', 'timezone' => 'Asia/Colombo', 'address' => 'Example Road 1', 'latitude' => 6.9, 'longitude' => 79.8, 'granted_devices_count' => 1], $data[0]);
        $this->assertSame(['uuid' => $this->yard->uuid, 'name' => 'Yard', 'timezone' => 'UTC', 'address' => null, 'latitude' => null, 'longitude' => null, 'granted_devices_count' => 0], $data[1]);
        // A scope counts every device at its sites, now and later, and nothing elsewhere.
        $scoped = $this->application(['site_uuids' => [$this->hall->uuid]]);
        $token = $this->token($scoped);
        $this->api($token, $this->read.'/sites')->assertOk()->assertJsonPath('data.*.granted_devices_count', [2, 0]);
        $y1->update(['site_id' => $this->hall->id]);
        $this->api($token, $this->read.'/sites')->assertJsonPath('data.*.granted_devices_count', [3, 0]);
        $this->api($token, $this->read.'/devices')->assertOk()->assertJsonPath('meta.total', 3);
    }

    public function test_the_ability_is_required_on_the_application_and_the_token(): void
    {
        $granted = $this->application(['device_uuids' => [$this->devices[0]->uuid]]);
        $this->api($this->token($granted, ['devices:read']), $this->read.'/sites')->assertForbidden();
        $withoutAbility = $this->application(['device_uuids' => [$this->devices[0]->uuid]], ['devices:read']);
        $this->api($this->token($withoutAbility), $this->read.'/sites')->assertForbidden();
        $this->api($this->token($granted), $this->read.'/devices')->assertOk();
        Auth::forgetGuards();
        $this->withoutToken()->actingAs(User::where('is_super_admin', true)->firstOrFail())->getJson($this->read.'/sites')->assertUnauthorized();
    }

    public function test_another_organization_cannot_be_read_through_a_list_or_a_scope(): void
    {
        $foreignBase = '/api/integration/v1/organizations/'.$this->other->uuid;
        $listed = $this->application(['device_uuids' => [$this->devices[0]->uuid]]);
        $this->api($this->token($listed), $foreignBase.'/sites')->assertNotFound();
        $scoped = $this->application(['site_uuids' => [$this->hall->uuid]]);
        $this->api($this->token($scoped), $foreignBase.'/sites')->assertNotFound();
        $data = $this->api($this->token($scoped), $this->read.'/sites')->assertOk()->json('data');
        $this->assertNotContains('Foreign plant', array_column($data, 'name'));
    }
}
