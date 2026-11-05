<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Firmware;

use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

final class StarterTest extends TestCase
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

    public function test_every_target_builds_the_starter_layout_for_both_roles(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        $relay = $this->publish('relay')[1];
        $water = $this->publish('water-meter')[0];
        $energy = $this->publish('energy-meter')[0];
        foreach ($this->getJson($this->prefix.'/firmware/targets')->json('data') as $target) {
            $direct = $this->starter(['target' => $target['id'], 'role' => 'direct', 'node_artifact_uuid' => $relay]);
            $root = 'relay-'.$target['id'].'-starter/';
            $files = $this->unzip($direct['archive_base64']);
            $developer = $direct['manifest']['developer_paths'][0];
            $this->assertSame('relay-'.$target['id'].'-starter.zip', $direct['filename']);
            foreach (['README.md', 'AGENTS.md', 'CLAUDE.md', 'iotos-starter.json', '.gitignore', 'config/README.md', 'sdk/VERSION', 'sdk/include/iotos/iotos.h',
                'sdk/starter/settings_missing.c', 'sdk/examples/desktop-simulator/main.c', 'generated/iotos_types.c', 'generated/iotos_types.h',
                'generated/iotos_type_relay.h', 'generated/profiles/relay.json', '.iotos/device-brief.schema.json', '.iotos/porting.md',
                $developer.'field.c', $developer.'field.h', $developer.'device-brief.example.yaml'] as $path) {
                $this->assertArrayHasKey($root.$path, $files, $target['id'].': '.$path);
            }
            $this->assertSame([], array_values(array_filter(array_keys($files), fn ($path) => str_contains($path, 'sample-config/') || str_contains($path, '/tests/'))));
            $this->assertSame($target['kind'] === 'built', isset($files[$root.'CMakeLists.txt']) && isset($files[$root.$developer.'main.c']), $target['id']);
            $this->assertSame($target['kind'] === 'ai_assisted', isset($files[$root.$developer.'ports/stream-template.c']) && isset($files[$root.'.iotos/reference/main.c']), $target['id']);
            $this->assertSame($target['id'] === 'esp32-esp-idf', str_contains($files[$root.'.gitignore'], 'sdkconfig'), $target['id'].' .gitignore');
            $this->assertSame($direct['manifest'], json_decode($files[$root.'iotos-starter.json'], true));

            $gateway = $this->starter(['target' => $target['id'], 'role' => 'gateway', 'node_artifact_uuid' => null, 'device_type_artifact_uuids' => [$water, $energy]]);
            $this->assertSame('water-meter-'.$target['id'].'-starter.zip', $gateway['filename']);
            $this->assertStringContainsString('#define IOTOS_KIT_ROLE_GATEWAY 1', $this->unzip($gateway['archive_base64'])['water-meter-'.$target['id'].'-starter/generated/iotos_types.h']);
        }
    }

    public function test_an_esp32_starter_is_an_esp_idf_project_whose_developer_path_is_main(): void
    {
        $starter = $this->starter(['target' => 'esp32-esp-idf', 'role' => 'direct', 'node_artifact_uuid' => $this->publish('relay')[1]]);
        $root = 'relay-esp32-esp-idf-starter/';
        $files = $this->unzip($starter['archive_base64']);

        $this->assertSame(['main/'], $starter['manifest']['developer_paths']);
        foreach (['CMakeLists.txt', 'sdkconfig.defaults', 'components/iotos/CMakeLists.txt', 'main/CMakeLists.txt', 'main/Kconfig.projbuild', 'main/main.c',
            'sdk/cmake/iotos_sources.cmake', 'sdk/ports/esp-idf/component.cmake', 'sdk/ports/esp-idf/stream.c', 'sdk/ports/freertos/lock.c'] as $path) {
            $this->assertArrayHasKey($root.$path, $files, $path);
        }
        // The field side is generated for this profile, not copied from the example's sample tables.
        $this->assertStringContainsString('field_read_relay_relay_state', $files[$root.'main/field.c']);
        $this->assertStringNotContainsString('water_meter', $files[$root.'main/field.h']);
        $this->assertSame([], array_values(array_filter(array_keys($files), fn (string $path): bool => preg_match('#/(sdkconfig|sdkconfig\.old|build/.*|managed_components/.*|app/.*)$#', $path) === 1)));
        // sdkconfig holds the Wi-Fi password.
        $this->assertStringContainsString("sdkconfig\nsdkconfig.old\nmanaged_components/\n", $files[$root.'.gitignore']);
        $this->assertStringContainsString('`idf.py menuconfig`', $files[$root.'README.md']);
        $this->assertStringContainsString('| `README.md`, `.gitignore`, `CMakeLists.txt`, `components/`, `sdkconfig.defaults` |', $files[$root.'README.md']);
    }

    public function test_an_nxp_starter_is_a_freestanding_mcuxpresso_project_without_the_vendor_sdk(): void
    {
        $water = $this->publish('water-meter')[0];
        $starter = $this->starter(['target' => 'nxp-imxrt1050-mcuxpresso', 'role' => 'gateway', 'device_type_artifact_uuids' => [$water]]);
        $root = 'water-meter-nxp-imxrt1050-mcuxpresso-starter/';
        $files = $this->unzip($starter['archive_base64']);

        $this->assertSame(['app/'], $starter['manifest']['developer_paths']);
        foreach (['CMakeLists.txt', 'prj.conf', 'lwipopts.h', 'board/pin_mux.c', 'board/hardware_init.c', 'board/rs485_pins.c', 'app/main.c',
            'app/modbus_rtu.c', 'app/modbus_rtu.h', 'sdk/cmake/iotos_sources.cmake', 'sdk/ports/mcuxpresso-lwip/iotos_mcux.cmake',
            'sdk/ports/mcuxpresso-lwip/stream_mbedtls_lwip.c', 'sdk/ports/mcuxpresso-lwip/iotos_mbedtls_config.h', 'sdk/ports/freertos/log.c'] as $path) {
            $this->assertArrayHasKey($root.$path, $files, $path);
        }
        // The field side is generated for this profile, not copied from the example's sample tables.
        $this->assertStringContainsString('water_meter', $files[$root.'app/field.c']);
        // The MCUXpresso SDK, its toolchain and its build output stay with the developer.
        $this->assertSame([], array_values(array_filter(array_keys($files), fn (string $path): bool => preg_match('#/(mcuxsdk|devices|drivers|middleware|build|\.west)/#', $path) === 1)));
        $this->assertStringContainsString('`MCUXSDK_ROOT`', $files[$root.'README.md']);
        $this->assertStringContainsString('| `README.md`, `.gitignore`, `CMakeLists.txt`, `board/`, `lwipopts.h`, `prj.conf` |', $files[$root.'README.md']);
        // A direct device has no bus to poll: the poller builds only for a gateway.
        $this->assertStringContainsString('#if IOTOS_KIT_ROLE_GATEWAY', $files[$root.'app/modbus_rtu.c']);
    }

    public function test_a_gateway_without_a_health_profile_uses_the_sdk_default_table(): void
    {
        $manifest = $this->starter(['target' => 'linux', 'role' => 'gateway', 'device_type_artifact_uuids' => [$this->publish('water-meter')[0]]])['manifest'];

        $this->assertSame(['default_health' => true, 'c_identifier' => 'gateway_health'], $manifest['node']);
        $this->assertSame(['water-meter'], array_keys($manifest['metrics']));
        $this->assertSame([], $manifest['warnings']);
    }

    public function test_the_manifest_records_what_changed_in_each_revision(): void
    {
        [$first, $second] = $this->publish('relay');

        $manifest = $this->starter(['target' => 'linux', 'role' => 'direct', 'node_artifact_uuid' => $second])['manifest'];

        $this->assertSame([
            ['key' => 'relay_state', 'datatype' => 'Boolean', 'unit' => null, 'writable' => true, 'introduced_in' => 1, 'changed_in' => null],
            ['key' => 'coil_current', 'datatype' => 'Double', 'unit' => 'mA', 'writable' => false, 'introduced_in' => 1, 'changed_in' => 2],
            ['key' => 'trip_count', 'datatype' => 'Int64', 'unit' => null, 'writable' => false, 'introduced_in' => 2, 'changed_in' => null],
        ], $manifest['metrics']['relay']);
        $this->assertSame([['key' => 'legacy_flag', 'retired_in' => 2]], $manifest['retired']['relay']);
        // A starter for the older revision is built from that revision alone.
        $older = $this->starter(['target' => 'linux', 'role' => 'direct', 'node_artifact_uuid' => $first])['manifest'];
        $this->assertSame(['relay_state', 'coil_current', 'legacy_flag'], array_column($older['metrics']['relay'], 'key'));
    }

    public function test_the_same_request_builds_the_same_files(): void
    {
        $body = ['target' => 'linux', 'role' => 'gateway', 'device_type_artifact_uuids' => [$this->publish('water-meter')[0], $this->publish('energy-meter')[0]]];
        $first = $this->unzip($this->starter($body)['archive_base64']);
        $this->travel(2)->minutes();
        $second = $this->unzip($this->starter($body)['archive_base64']);

        $manifest = 'water-meter-linux-starter/iotos-starter.json';
        $this->assertNotSame($first[$manifest], $second[$manifest]);
        $strip = fn (array $files): array => [...$files, $manifest => preg_replace('/"generated_at": "[^"]+"/', '', $files[$manifest])];
        $this->assertSame($strip($first), $strip($second));
    }

    public function test_limits_name_the_sdk_macro_that_raises_them(): void
    {
        $this->postJson($this->prefix.'/firmware/starters', ['target' => 'linux', 'role' => 'direct', 'node_artifact_uuid' => $this->publish('wide-65')[0]])
            ->assertUnprocessable()->assertJsonValidationErrors(['node_artifact_uuid' => 'IOTOS_MAX_METRICS_PER_TYPE']);
        $nine = array_map(fn (int $n): string => $this->publish('wide-64', null, 'wide-'.$n)[0], range(1, 9));
        $this->postJson($this->prefix.'/firmware/starters', ['target' => 'linux', 'role' => 'gateway', 'device_type_artifact_uuids' => $nine])
            ->assertUnprocessable()->assertJsonValidationErrors(['device_type_artifact_uuids' => 'IOTOS_MAX_DEVICE_TYPES']);
    }

    public function test_requests_are_validated_against_the_target_and_role(): void
    {
        $relay = $this->publish('relay')[1];
        $this->postJson($this->prefix.'/firmware/starters', [])->assertUnprocessable()->assertJsonValidationErrors(['target', 'role']);
        $this->postJson($this->prefix.'/firmware/starters', ['target' => 'esp8266', 'role' => 'direct', 'node_artifact_uuid' => $relay])
            ->assertUnprocessable()->assertJsonValidationErrors(['target' => 'Choose one of the available firmware targets.']);
        $this->postJson($this->prefix.'/firmware/starters', ['target' => 'linux', 'role' => 'direct', 'node_artifact_uuid' => $relay, 'device_type_artifact_uuids' => [$relay]])
            ->assertUnprocessable()->assertJsonValidationErrors(['device_type_artifact_uuids']);
        $this->postJson($this->prefix.'/firmware/starters', ['target' => 'linux', 'role' => 'gateway', 'device_type_artifact_uuids' => [$relay, $relay]])
            ->assertUnprocessable()->assertJsonValidationErrors(['device_type_artifact_uuids.1' => 'Each device type can appear only once.']);
    }

    public function test_only_published_revisions_of_this_organization_can_be_used(): void
    {
        $other = $this->publish('relay', Organization::where('slug', 'northstar-utilities')->firstOrFail())[1];
        $this->postJson($this->prefix.'/firmware/starters', ['target' => 'linux', 'role' => 'direct', 'node_artifact_uuid' => $other])->assertNotFound();
        // A draft has no artifact, so its UUID is unknown here.
        $this->postJson($this->prefix.'/firmware/starters', ['target' => 'linux', 'role' => 'direct', 'node_artifact_uuid' => '00000000-0000-4000-8000-000000000999'])->assertNotFound();
        $this->assertSame(0, DeviceProfileArtifact::where('uuid', '00000000-0000-4000-8000-000000000999')->count());
    }

    public function test_members_can_download_starters_but_people_without_profile_access_cannot(): void
    {
        $relay = $this->publish('relay')[1];
        $this->actAs('acme.member@example.test');
        $this->postJson($this->prefix.'/firmware/starters', ['target' => 'linux', 'role' => 'direct', 'node_artifact_uuid' => $relay])
            ->assertOk()->assertHeader('Cache-Control', 'no-store, private')->assertHeader('Pragma', 'no-cache');
        $this->assertSame(0, DB::table('activity_log')->where('event', 'like', '%firmware%')->count(), 'starters hold no secrets and are not recorded');

        $stranger = User::factory()->create();
        $this->organization->users()->attach($stranger->id);
        $this->actAs($stranger);
        $this->postJson($this->prefix.'/firmware/starters', ['target' => 'linux', 'role' => 'direct', 'node_artifact_uuid' => $relay])->assertForbidden();
    }

    public function test_downloads_are_limited_to_ten_a_minute(): void
    {
        $body = ['target' => 'other', 'role' => 'direct', 'node_artifact_uuid' => $this->publish('relay')[1]];
        foreach (range(1, 10) as $attempt) {
            $this->postJson($this->prefix.'/firmware/starters', $body)->assertOk();
        }
        $this->postJson($this->prefix.'/firmware/starters', $body)->assertTooManyRequests();
    }

    public function test_signing_in_is_required(): void
    {
        $this->app['auth']->forgetGuards();
        $this->postJson($this->prefix.'/firmware/starters', ['target' => 'linux', 'role' => 'direct'])->assertUnauthorized();
        $this->getJson($this->prefix.'/firmware/targets')->assertUnauthorized();
    }

    public function test_a_starter_of_eight_wide_types_is_quick_and_small(): void
    {
        $types = array_map(fn (int $n): string => $this->publish('wide-64', null, 'wide-'.$n)[0], range(1, 8));

        $started = microtime(true);
        $starter = $this->starter(['target' => 'linux', 'role' => 'gateway', 'device_type_artifact_uuids' => $types]);
        $seconds = microtime(true) - $started;

        $this->assertLessThan(3.0, $seconds);
        $this->assertLessThan(2 * 1024 * 1024, strlen(base64_decode($starter['archive_base64'])));
        $this->assertCount(8, $starter['manifest']['device_types']);
    }

    private function starter(array $body): array
    {
        return $this->postJson($this->prefix.'/firmware/starters', $body)->assertOk()->json('data');
    }
}
