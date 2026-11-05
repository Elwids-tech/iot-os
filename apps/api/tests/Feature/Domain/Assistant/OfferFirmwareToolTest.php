<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Assistant;

use App\Domain\Assistant\Models\AssistantConversation;
use App\Domain\Assistant\Models\AssistantRun;
use App\Domain\Assistant\Tools\OnboardingTools;
use App\Domain\Assistant\Tools\ProfileAssistantTools;
use App\Domain\Authorization\Models\Role;
use App\Domain\DeviceProfiles\Enums\DeviceProfileStatus;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\Firmware\Services\TargetRegistry;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Ai\Tools\Request;
use Spatie\Permission\PermissionRegistrar;
use Tests\Feature\Domain\Firmware\FirmwareTestSupport;
use Tests\TestCase;

/** The assistant offers firmware starters as a card and never handles credentials (spec 027 US5, SC-005). */
final class OfferFirmwareToolTest extends TestCase
{
    use FirmwareTestSupport, RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpFirmware();
        $this->admin = User::where('is_super_admin', true)->firstOrFail();
        config(['adapters.enabled' => true]);
    }

    protected function tearDown(): void
    {
        $this->tearDownFirmware();
        parent::tearDown();
    }

    private function startRun(string $scope = 'onboarding', ?User $user = null, ?DeviceProfile $profile = null): AssistantRun
    {
        $conversation = AssistantConversation::create(['scope' => $scope, 'organization_id' => $this->organization->id, 'user_id' => ($user ?? $this->admin)->id,
            'device_profile_id' => $profile?->id, 'title' => 'Firmware']);

        return $conversation->runs()->create(['request_id' => (string) Str::uuid(), 'status' => 'running']);
    }

    /** Calls offer_firmware as the model does, with JSON arguments. */
    private function offer(AssistantRun $run, array $args, string $tool = OnboardingTools::class): array
    {
        return json_decode((string) (new $tool($run))->handle(new Request(['action' => 'offer_firmware', 'arguments_json' => json_encode($args)])), true);
    }

    private function profile(string $code): DeviceProfile
    {
        return DeviceProfile::where('code', $code)->where('organization_id', $this->organization->id)->firstOrFail();
    }

    public function test_an_offer_is_stored_and_emitted_with_names_only(): void
    {
        $this->publish('relay');
        $relay = $this->profile('relay');
        $run = $this->startRun();

        $result = $this->offer($run, ['profile_uuid' => $relay->uuid, 'target' => 'linux', 'role' => 'direct']);

        $this->assertTrue($result['shown']);
        $this->assertSame(['name' => $relay->name, 'revision' => 2], $result['profile']);
        $this->assertSame(['name' => 'Linux or macOS', 'kind' => 'built'], $result['target']);
        $offer = $run->conversation->fresh()->onboarding_state['firmware_offer'];
        $this->assertSame(['profile_uuid' => $relay->uuid, 'target' => 'linux', 'role' => 'direct'], array_diff_key($offer, ['at' => true]));
        $event = DB::table('assistant_events')->where('conversation_id', $run->conversation_id)->where('type', 'firmware_offer')->sole();
        $this->assertSame($offer, json_decode($event->payload, true));
        $this->assertSame($run->id, $event->run_id);

        // The profile assistant offers the same card, here for a gateway behind which the profile is a device type.
        $profileRun = $this->startRun('profile', profile: $relay);
        $this->assertTrue($this->offer($profileRun, ['profile_uuid' => $relay->uuid, 'target' => 'stm32', 'role' => 'gateway'], ProfileAssistantTools::class)['shown']);
        $this->assertSame(['profile_uuid' => $relay->uuid, 'target' => 'stm32', 'role' => 'gateway'],
            array_diff_key($profileRun->conversation->fresh()->onboarding_state['firmware_offer'], ['at' => true]));
    }

    public function test_offers_are_refused_for_profiles_the_person_may_not_use_and_unavailable_targets(): void
    {
        $this->publish('relay');
        $relay = $this->profile('relay');
        $draft = DeviceProfile::create(['organization_id' => $this->organization->id, 'code' => 'draft-meter', 'name' => 'Draft meter', 'category' => 'test',
            'status' => DeviceProfileStatus::DRAFT, 'revision' => 0]);
        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $this->publish('water-meter', $northstar);
        $foreign = DeviceProfile::where('organization_id', $northstar->id)->firstOrFail();
        $run = $this->startRun();

        $refused = [
            'drafts only' => [['profile_uuid' => $draft->uuid, 'target' => 'linux', 'role' => 'direct'], 'no published version'],
            'another organization' => [['profile_uuid' => $foreign->uuid, 'target' => 'linux', 'role' => 'direct'], 'No device profile with that uuid'],
            'unknown target' => [['profile_uuid' => $relay->uuid, 'target' => 'z80', 'role' => 'direct'], 'Unknown firmware target'],
            'unknown role' => [['profile_uuid' => $relay->uuid, 'target' => 'linux', 'role' => 'sensor'], null],
        ];
        foreach ($refused as $case => [$args, $reason]) {
            $result = $this->offer($run, $args);
            $this->assertArrayHasKey('error', $result, $case);
            if ($reason !== null) {
                $this->assertStringContainsString($reason, (string) $result['reason'], $case);
            }
        }

        // A target that does not support the role is refused too.
        $root = sys_get_temp_dir().'/iot-firmware-targets-'.bin2hex(random_bytes(6));
        mkdir($root.'/starters', 0700, true);
        file_put_contents($root.'/starters/targets.json', json_encode(['format' => 1, 'targets' => [
            ['id' => 'tiny-mcu', 'name' => 'Tiny MCU', 'kind' => 'ai_assisted', 'roles' => ['direct'], 'developer_paths' => ['app/'], 'order' => 1, 'family_notes' => null],
        ]]));
        try {
            $this->app->instance(TargetRegistry::class, new TargetRegistry($root));
            $result = $this->offer($run, ['profile_uuid' => $relay->uuid, 'target' => 'tiny-mcu', 'role' => 'gateway']);
            $this->assertSame('Tiny MCU does not support the gateway role.', $result['reason']);
            $this->assertTrue($this->offer($run, ['profile_uuid' => $relay->uuid, 'target' => 'tiny-mcu', 'role' => 'direct'])['shown']);
        } finally {
            (new Filesystem)->deleteDirectory($root);
        }
        $this->assertSame(1, DB::table('assistant_events')->where('conversation_id', $run->conversation_id)->where('type', 'firmware_offer')->count());
    }

    public function test_a_person_without_profile_view_gets_no_offer(): void
    {
        $this->publish('relay');
        $registrar = app(PermissionRegistrar::class);
        $registrar->setPermissionsTeamId($this->organization->id);
        $role = Role::create(['name' => 'installer', 'display_name' => 'Installer', 'guard_name' => 'web', 'organization_id' => $this->organization->id, 'is_default' => false]);
        $role->givePermissionTo(['Device.view', 'Device.manage']);
        $installer = User::factory()->create();
        $this->organization->users()->attach($installer);
        $installer->assignRole($role);
        $registrar->setPermissionsTeamId(null);
        $registrar->forgetCachedPermissions();
        $run = $this->startRun(user: $installer);

        $result = $this->offer($run, ['profile_uuid' => $this->profile('relay')->uuid, 'target' => 'linux', 'role' => 'direct']);

        $this->assertSame('This person may not view device profiles, so no firmware can be offered.', $result['reason']);
        $this->assertArrayNotHasKey('firmware_offer', $run->conversation->fresh()->onboarding_state ?? []);
        $this->assertSame(0, DB::table('assistant_events')->where('conversation_id', $run->conversation_id)->count());
    }

    public function test_no_credentials_reach_the_tool_result_or_the_stored_conversation(): void
    {
        $relay = $this->publish('relay')[1];
        $this->publish('water-meter');
        $gateway = $this->gateway();
        $direct = $this->directDevice($relay);
        $secrets = [...$this->secrets($gateway), ...$this->secrets($direct['gateway'])];
        $run = $this->startRun();

        $results = [
            $this->offer($run, ['profile_uuid' => $this->profile('relay')->uuid, 'target' => 'linux', 'role' => 'direct']),
            $this->offer($run, ['profile_uuid' => $this->profile('water-meter')->uuid, 'target' => 'esp32-esp-idf', 'role' => 'gateway']),
        ];

        $stored = json_encode([
            $results,
            $run->conversation->fresh()->onboarding_state,
            DB::table('assistant_events')->where('conversation_id', $run->conversation_id)->pluck('payload')->all(),
        ]);
        $this->assertStringContainsString('firmware_offer', $stored);
        foreach ($secrets as $secret) {
            $this->assertStringNotContainsString($secret, $stored);
        }
        $this->assertStringNotContainsString('archive', $stored);
    }
}
