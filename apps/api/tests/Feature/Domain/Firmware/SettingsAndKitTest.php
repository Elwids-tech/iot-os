<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Firmware;

use App\Domain\DeviceProfiles\Models\DeviceProfile;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

final class SettingsAndKitTest extends TestCase
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

    public function test_device_settings_unpack_into_a_starter_beside_todays_kit_files(): void
    {
        $direct = $this->directDevice($this->publish('relay')[1]);
        $device = $this->prefix.'/devices/'.$direct['device']->uuid;

        $settings = $this->postJson($device.'/connection-settings')->assertOk()->assertHeader('Cache-Control', 'no-store, private')->json('data');

        $this->assertSame($direct['device']->code.'-connection-settings.zip', $settings['filename']);
        $this->assertNull($settings['manifest']);
        $files = $this->unzip($settings['archive_base64']);
        $this->assertSame(['ca.crt', 'config/README.md', 'config/iotos_settings.c', 'config/iotos_settings.h', 'device-config.json', 'quickstart.md'], array_keys($files));
        $this->assertStringContainsString('#define IOTOS_KIT_PASSWORD "'.$direct['gateway']->password.'"', $files['config/iotos_settings.h']);
        $this->assertStringContainsString('#define IOTOS_KIT_GATEWAY 0', $files['config/iotos_settings.h']);
        $this->assertStringContainsString('#define IOTOS_KIT_SETTINGS_FORMAT 1', $files['config/iotos_settings.h']);
        $kit = $this->unzip($this->postJson($device.'/connection-kit')->assertOk()->json('data.archive_base64'));
        foreach (['ca.crt', 'device-config.json', 'quickstart.md'] as $path) {
            $this->assertSame($kit[$path], $files[$path], $path.' stays as today\'s connection kit');
        }
    }

    public function test_a_full_kit_is_the_starter_with_the_settings_in_place(): void
    {
        $relay = $this->publish('relay')[1];
        $direct = $this->directDevice($relay);
        $device = $this->prefix.'/devices/'.$direct['device']->uuid;

        $kit = $this->postJson($device.'/firmware-kit', ['target' => 'linux'])->assertOk()->json('data');
        $starter = $this->postJson($this->prefix.'/firmware/starters', ['target' => 'linux', 'role' => 'direct', 'node_artifact_uuid' => $relay])->json('data');
        $settings = $this->unzip($this->postJson($device.'/connection-settings')->json('data.archive_base64'));

        $this->assertSame($direct['device']->code.'-linux-firmware-kit.zip', $kit['filename']);
        $root = 'relay-linux-starter/';
        $expected = $this->unzip($starter['archive_base64']);
        foreach ($settings as $path => $contents) {
            $expected[$root.$path] = $contents;
        }
        ksort($expected);
        $actual = $this->unzip($kit['archive_base64']);
        $manifest = $root.'iotos-starter.json';
        $actual[$manifest] = $expected[$manifest]; // only generated_at may differ
        $this->assertSame($expected, $actual);
        $event = DB::table('activity_log')->where('event', 'device.firmware-kit.downloaded')->first();
        $this->assertSameJsonDocument(['target' => 'linux', 'sdk_version' => '0.1.0', 'profiles' => [['code' => 'relay', 'revision' => 2]]], json_decode($event->properties, true));
    }

    public function test_gateway_settings_apply_broker_access_and_saved_choices_carry_over(): void
    {
        $water = $this->publish('water-meter')[0];
        $energy = $this->publish('energy-meter')[0];
        $gateway = $this->gateway();
        $url = $this->prefix.'/gateways/'.$gateway->uuid;

        $settings = $this->unzip($this->postJson($url.'/connection-settings')->assertOk()->json('data.archive_base64'));
        $this->assertSame(['config/README.md', 'config/iotos_settings.c', 'config/iotos_settings.h'], array_keys($settings));
        $this->assertStringContainsString('#define IOTOS_KIT_EDGE_NODE_ID "line2-edge"', $settings['config/iotos_settings.h']);
        Http::assertSent(fn ($request) => $request->method() === 'PUT' && str_ends_with($request->url(), '/clients') && $request['username'] === $gateway->username);

        $kit = $this->postJson($url.'/firmware-kit', ['target' => 'stm32', 'device_type_artifact_uuids' => [$water, $energy]])->assertOk()->json('data');
        $this->assertSame('line2-edge-stm32-firmware-kit.zip', $kit['filename']);
        $this->assertArrayHasKey('water-meter-stm32-starter/config/iotos_settings.h', $this->unzip($kit['archive_base64']));
        $this->assertSame(['format' => 1, 'target' => 'stm32', 'node_profile_uuid' => null], array_intersect_key($gateway->fresh()->firmware_selection, array_flip(['format', 'target', 'node_profile_uuid'])));

        // A teammate's next download starts from the saved choices.
        $again = $this->postJson($url.'/firmware-kit')->assertOk()->json('data.manifest');
        $this->assertSame('stm32', $again['target']['id']);
        $this->assertSame(['water-meter', 'energy-meter'], array_column($again['device_types'], 'code'));
        $listed = collect($this->getJson($this->prefix.'/gateways')->assertOk()->json('data'))->firstWhere('uuid', $gateway->uuid)['firmware_selection'];
        $this->assertSame('stm32', $listed['target']);
        $this->assertCount(2, $listed['device_profile_uuids']);
        $this->assertArrayNotHasKey('saved_by_user_id', $listed);

        DeviceProfile::where('code', 'energy-meter')->firstOrFail()->forceFill(['deleted_at' => now()])->save();
        $listed = collect($this->getJson($this->prefix.'/gateways')->json('data'))->firstWhere('uuid', $gateway->uuid)['firmware_selection'];
        $this->assertSame([DeviceProfile::where('code', 'water-meter')->value('uuid')], $listed['device_profile_uuids']);
        $this->assertSame(1, DB::table('activity_log')->where('event', 'gateway.connection-settings.downloaded')->count());
        $this->assertSame(2, DB::table('activity_log')->where('event', 'gateway.firmware-kit.downloaded')->count());
    }

    public function test_activity_entries_never_hold_secrets(): void
    {
        $direct = $this->directDevice($this->publish('relay')[1]);
        $gateway = $this->gateway();
        $water = $this->publish('water-meter')[0];
        $this->postJson($this->prefix.'/devices/'.$direct['device']->uuid.'/connection-settings')->assertOk();
        $this->postJson($this->prefix.'/devices/'.$direct['device']->uuid.'/firmware-kit', ['target' => 'linux'])->assertOk();
        $this->postJson($this->prefix.'/gateways/'.$gateway->uuid.'/connection-settings')->assertOk();
        $this->postJson($this->prefix.'/gateways/'.$gateway->uuid.'/firmware-kit', ['target' => 'linux', 'device_type_artifact_uuids' => [$water]])->assertOk();

        $events = DB::table('activity_log')->where('event', 'like', '%.downloaded')->get();
        $this->assertCount(4, $events);
        foreach ([$direct['gateway']->password, $gateway->password, $gateway->username, 'BEGIN CERTIFICATE'] as $secret) {
            $this->assertStringNotContainsString($secret, json_encode($events));
        }
    }

    public function test_settings_and_kits_need_a_ready_connection_and_an_active_device(): void
    {
        $direct = $this->directDevice($this->publish('relay')[1]);
        $direct['device']->forceFill(['lifecycle' => 'archived'])->save();
        $this->postJson($this->prefix.'/devices/'.$direct['device']->uuid.'/connection-settings')->assertUnprocessable();
        $this->postJson($this->prefix.'/devices/'.$direct['device']->uuid.'/firmware-kit', ['target' => 'linux'])->assertUnprocessable();

        $gateway = $this->gateway();
        $gateway->connection->update(['status' => 'pending']);
        $this->postJson($this->prefix.'/gateways/'.$gateway->uuid.'/connection-settings')->assertUnprocessable()
            ->assertJsonPath('message', 'Provision this gateway\'s connection first.');
        $gateway->connection->update(['status' => 'ready']);
        $gateway->forceFill(['password' => null])->save();
        $this->postJson($this->prefix.'/gateways/'.$gateway->uuid.'/connection-settings')->assertUnprocessable()
            ->assertJsonPath('message', 'This gateway has no platform-issued credentials.');
        $this->postJson($this->prefix.'/gateways/'.$gateway->uuid.'/firmware-kit', [])->assertUnprocessable()->assertJsonValidationErrors(['target']);
    }

    public function test_the_server_export_command_still_writes_a_gateways_file(): void
    {
        $gateway = $this->gateway();
        $output = sys_get_temp_dir().'/iot-gateway-export-'.bin2hex(random_bytes(6)).'.json';
        try {
            $this->assertSame(0, Artisan::call('devices:export-gateway', ['gateway' => $gateway->uuid, '--output' => $output, '--broker' => 'ssl://mqtt.example.test:8883', '--ca' => '/etc/ca.crt']));
            $this->assertSame('line2-edge', json_decode((string) file_get_contents($output), true)['edge_node_id']);
        } finally {
            @unlink($output);
        }
    }
}
