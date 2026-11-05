<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Firmware;

use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class TargetsTest extends TestCase
{
    use FirmwareTestSupport, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpFirmware();
    }

    protected function tearDown(): void
    {
        $this->tearDownFirmware();
        parent::tearDown();
    }

    public function test_members_see_the_available_targets_built_first(): void
    {
        $this->actAs('acme.member@example.test');

        $targets = $this->getJson($this->prefix.'/firmware/targets')->assertOk()->json('data');

        $this->assertSame(['esp32-esp-idf', 'nxp-imxrt1050-mcuxpresso', 'linux', 'stm32', 'rpi-pico', 'nordic-nrf', 'other'], array_column($targets, 'id'));
        $this->assertSame(['id' => 'esp32-esp-idf', 'name' => 'ESP32 (ESP-IDF)', 'kind' => 'built', 'roles' => ['direct', 'gateway'], 'toolchain' => 'ESP-IDF v5.4.1'], $targets[0]);
        $this->assertSame(['id' => 'nxp-imxrt1050-mcuxpresso', 'name' => 'NXP i.MX RT1050 (MCUXpresso SDK)', 'kind' => 'built', 'roles' => ['direct', 'gateway'], 'toolchain' => 'MCUXpresso SDK 26.09.00, Arm GNU Toolchain 14.2.rel1'], $targets[1]);
        $this->assertSame(['id' => 'linux', 'name' => 'Linux or macOS', 'kind' => 'built', 'roles' => ['direct', 'gateway'], 'toolchain' => 'CMake 3.31, GCC 13 (ubuntu-24.04 runner)'], $targets[2]);
        $this->assertNull($targets[3]['toolchain']);
    }

    public function test_a_target_without_its_files_is_not_offered(): void
    {
        $root = sys_get_temp_dir().'/iot-firmware-registry-'.bin2hex(random_bytes(6));
        mkdir($root.'/starters', 0700, true);
        copy(base_path('../../firmware/starters/targets.json'), $root.'/starters/targets.json');
        config(['firmware.path' => $root]);
        try {
            // Neither the Linux example nor the named families' notes exist here; "other" needs nothing.
            $this->getJson($this->prefix.'/firmware/targets')->assertOk()->assertJsonPath('data.*.id', ['other']);
        } finally {
            unlink($root.'/starters/targets.json');
            rmdir($root.'/starters');
            rmdir($root);
        }
    }

    public function test_people_outside_the_organization_cannot_list_targets(): void
    {
        $this->actAs(User::factory()->create());
        $this->getJson($this->prefix.'/firmware/targets')->assertForbidden();
    }
}
