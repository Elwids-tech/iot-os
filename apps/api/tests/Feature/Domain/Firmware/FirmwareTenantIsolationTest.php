<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Firmware;

use App\Domain\Shared\Models\Organization;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/** Settings and kits carry credentials: other organizations cannot find them, and members cannot download them. */
final class FirmwareTenantIsolationTest extends TestCase
{
    use FirmwareTestSupport, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpFirmware();
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    protected function tearDown(): void
    {
        $this->tearDownFirmware();
        parent::tearDown();
    }

    public function test_another_organizations_device_or_gateway_is_not_found(): void
    {
        $direct = $this->directDevice($this->publish('relay')[1]);
        $gateway = $this->gateway();
        $other = '/api/v1/organizations/'.Organization::where('slug', 'northstar-utilities')->firstOrFail()->uuid;

        foreach (['/devices/'.$direct['device']->uuid, '/gateways/'.$gateway->uuid] as $resource) {
            $this->postJson($other.$resource.'/connection-settings')->assertNotFound();
            $this->postJson($other.$resource.'/firmware-kit', ['target' => 'linux'])->assertNotFound();
        }
        $this->postJson($other.'/firmware/starters', ['target' => 'linux', 'role' => 'gateway', 'device_type_artifact_uuids' => [$this->publish('water-meter')[0]], 'gateway_uuid' => $gateway->uuid])->assertNotFound();
    }

    public function test_members_without_connection_rights_cannot_download_credentials(): void
    {
        $direct = $this->directDevice($this->publish('relay')[1]);
        $gateway = $this->gateway();
        $water = $this->publish('water-meter')[0];
        $this->actAs('acme.member@example.test');

        $this->postJson($this->prefix.'/devices/'.$direct['device']->uuid.'/connection-settings')->assertForbidden();
        $this->postJson($this->prefix.'/devices/'.$direct['device']->uuid.'/firmware-kit', ['target' => 'linux'])->assertForbidden();
        $this->postJson($this->prefix.'/gateways/'.$gateway->uuid.'/connection-settings')->assertForbidden();
        $this->postJson($this->prefix.'/gateways/'.$gateway->uuid.'/firmware-kit', ['target' => 'linux'])->assertForbidden();
        // Saving choices on a gateway needs connection rights too; the starter alone does not.
        $this->postJson($this->prefix.'/firmware/starters', ['target' => 'linux', 'role' => 'gateway', 'device_type_artifact_uuids' => [$water], 'gateway_uuid' => $gateway->uuid])->assertForbidden();
        $this->postJson($this->prefix.'/firmware/starters', ['target' => 'linux', 'role' => 'gateway', 'device_type_artifact_uuids' => [$water]])->assertOk();
        $this->assertNull($gateway->fresh()->firmware_selection);
    }
}
