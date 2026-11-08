<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices;

use App\Domain\Authorization\Models\PlatformRole;
use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\PermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Spatie\Permission\Models\Permission;
use Tests\TestCase;

/**
 * Admin Settings → Retention lists organizations through its own route, so a platform
 * administrator who may manage retention but not organizations can still choose one and
 * set its override, without seeing the organization directory.
 */
final class RetentionOrganizationPickerTest extends TestCase
{
    use RefreshDatabase;

    private const PICKER = '/api/v1/admin/settings/telemetry-retention/organizations';

    private User $keeper;

    private Organization $harbour;

    private Organization $lakeside;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(PermissionSeeder::class);
        $this->keeper = $this->platformUser('retention-keeper', [PlatformAdministrationPermission::ACCESS, PlatformAdministrationPermission::MANAGE_RETENTION]);
        $this->lakeside = Organization::factory()->create(['name' => 'Lakeside Home', 'slug' => 'lakeside-home']);
        $this->harbour = Organization::factory()->create(['name' => 'Harbour Works', 'slug' => 'harbour-works']);
    }

    public function test_a_retention_only_administrator_lists_organizations_and_saves_an_override(): void
    {
        $this->actingAs($this->keeper, 'sanctum');
        $this->getJson('/api/v1/admin/organizations')->assertForbidden();

        // Names only: no member or device counts, no billing account.
        $this->getJson(self::PICKER)
            ->assertOk()
            ->assertJsonPath('data', [
                ['uuid' => $this->harbour->uuid, 'name' => 'Harbour Works'],
                ['uuid' => $this->lakeside->uuid, 'name' => 'Lakeside Home'],
            ])
            ->assertJsonPath('meta.last_page', 1);
        $this->getJson(self::PICKER.'?search=HARBOUR')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.uuid', $this->harbour->uuid);
        $this->getJson(self::PICKER.'?search=lakeside-home')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.name', 'Lakeside Home');
        $this->getJson(self::PICKER.'?per_page=1&page=2')->assertOk()->assertJsonPath('data.0.name', 'Lakeside Home')->assertJsonPath('meta.last_page', 2);

        $override = '/api/v1/admin/organizations/'.$this->lakeside->uuid.'/settings/telemetry-retention';
        $this->putJson($override, ['days' => 30, 'revision' => 0, 'confirmed_reduction' => true])
            ->assertOk()
            ->assertJsonPath('data.days', 30)
            ->assertJsonPath('data.source', 'organization');
        $this->getJson($override)->assertOk()->assertJsonPath('data.override_days', 30);
    }

    public function test_the_picker_needs_the_manage_retention_permission(): void
    {
        $this->getJson(self::PICKER)->assertUnauthorized();

        $this->actingAs($this->platformUser('organization-keeper', [PlatformAdministrationPermission::ACCESS, PlatformAdministrationPermission::MANAGE_ORGANIZATIONS]), 'sanctum');
        $this->getJson(self::PICKER)->assertForbidden();
    }

    /**
     * @param  list<PlatformAdministrationPermission>  $permissions
     */
    private function platformUser(string $key, array $permissions): User
    {
        $role = PlatformRole::query()->create(['key' => $key, 'display_name' => $key, 'is_system' => false]);
        $role->permissions()->sync(Permission::query()->whereIn('name', array_map(fn (PlatformAdministrationPermission $permission): string => $permission->value, $permissions))->pluck('id'));
        $user = User::factory()->create();
        $user->platformRoles()->attach($role->id);

        return $user;
    }
}
