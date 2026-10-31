<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Administration;

use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Super administrators grant and remove the platform-administrator role (spec 008).
 */
final class PlatformAdministratorApiTest extends TestCase
{
    use RefreshDatabase;

    private User $superAdmin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(DatabaseSeeder::class);
        $this->superAdmin = User::query()->where('email', 'super-admin@example.test')->firstOrFail();
    }

    public function test_super_administrators_make_an_existing_user_a_platform_administrator_who_keeps_their_memberships(): void
    {
        $member = User::query()->where('email', 'acme.member@example.test')->firstOrFail();
        $organizations = $member->organizations()->pluck('organizations.id')->all();
        $roles = $this->organizationRoles($member);

        $this->actingAs($member, 'sanctum')
            ->getJson('/api/v1/admin/organizations')
            ->assertForbidden();

        $this->actingAs($this->superAdmin, 'sanctum')
            ->putJson("/api/v1/admin/platform-team/{$member->id}", ['is_platform_administrator' => true])
            ->assertOk()
            ->assertJsonPath('data.id', $member->id)
            ->assertJsonPath('data.is_super_admin', false)
            ->assertJsonPath('data.platform_roles.0.key', 'platform-administrator');

        $this->assertSame(1, $this->auditEvents('user.platform_administrator_granted', $member));
        $this->assertSame($organizations, $member->organizations()->pluck('organizations.id')->all());
        $this->assertSame($roles, $this->organizationRoles($member));

        // The next request opens the admin app.
        $this->actingAs($member->fresh(), 'sanctum')
            ->getJson('/api/v1/admin/organizations')
            ->assertOk();

        // Repeating it changes nothing and records nothing.
        $this->actingAs($this->superAdmin, 'sanctum')
            ->putJson("/api/v1/admin/platform-team/{$member->id}", ['is_platform_administrator' => true])
            ->assertOk()
            ->assertJsonCount(1, 'data.platform_roles');
        $this->assertSame(1, $this->auditEvents('user.platform_administrator_granted', $member));
    }

    public function test_super_administrators_remove_the_platform_administrator_role(): void
    {
        $administrator = User::query()->where('email', 'platform-admin@example.test')->firstOrFail();

        $this->actingAs($this->superAdmin, 'sanctum')
            ->putJson("/api/v1/admin/platform-team/{$administrator->id}", ['is_platform_administrator' => false])
            ->assertOk()
            ->assertJsonPath('data.id', $administrator->id)
            ->assertJsonCount(0, 'data.platform_roles');

        $this->assertFalse($administrator->platformRoles()->exists());
        $this->assertSame(1, $this->auditEvents('user.platform_administrator_revoked', $administrator));

        $this->actingAs($this->superAdmin, 'sanctum')
            ->putJson("/api/v1/admin/platform-team/{$administrator->id}", ['is_platform_administrator' => false])
            ->assertOk();
        $this->assertSame(1, $this->auditEvents('user.platform_administrator_revoked', $administrator));

        // The next request is authorized without the role.
        $this->actingAs($administrator->fresh(), 'sanctum')
            ->getJson('/api/v1/admin/organizations')
            ->assertForbidden();
    }

    public function test_an_actor_removed_in_the_meantime_is_refused_under_the_lock(): void
    {
        $other = User::factory()->create(['is_super_admin' => true]);
        $member = User::query()->where('email', 'acme.member@example.test')->firstOrFail();
        // Another request removed this actor's access after they were authenticated.
        DB::table('users')->where('id', $other->id)->update(['is_super_admin' => false]);

        $this->actingAs($other, 'sanctum')
            ->putJson("/api/v1/admin/platform-team/{$member->id}", ['is_platform_administrator' => true])
            ->assertForbidden();

        $this->assertFalse($member->platformRoles()->exists());
        $this->assertSame(0, DB::table('activity_log')->where('event', 'like', 'user.platform_administrator_%')->count());
    }

    public function test_only_super_administrators_manage_platform_administrators(): void
    {
        $administrator = User::query()->where('email', 'platform-admin@example.test')->firstOrFail();
        $member = User::query()->where('email', 'acme.member@example.test')->firstOrFail();

        foreach ([$administrator, $member] as $actor) {
            $this->assertFalse($actor->is_super_admin);

            $this->actingAs($actor, 'sanctum')
                ->putJson("/api/v1/admin/platform-team/{$member->id}", ['is_platform_administrator' => true])
                ->assertForbidden();
            $this->actingAs($actor, 'sanctum')
                ->putJson("/api/v1/admin/platform-team/{$administrator->id}", ['is_platform_administrator' => false])
                ->assertForbidden();
        }

        $this->assertFalse($member->platformRoles()->exists());
        $this->assertTrue($administrator->platformRoles()->exists());
        $this->assertSame(0, DB::table('activity_log')->where('event', 'like', 'user.platform_administrator_%')->count());
    }

    public function test_unknown_and_non_numeric_users_are_not_found(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')
            ->putJson('/api/v1/admin/platform-team/999999', ['is_platform_administrator' => true])
            ->assertNotFound();
        $this->actingAs($this->superAdmin, 'sanctum')
            ->putJson('/api/v1/admin/platform-team/not-a-user', ['is_platform_administrator' => true])
            ->assertNotFound();
    }

    /**
     * @return list<string>
     */
    private function organizationRoles(User $user): array
    {
        return DB::table('model_has_roles')
            ->where('model_id', $user->id)
            ->orderBy('organization_id')
            ->orderBy('role_id')
            ->get(['organization_id', 'role_id'])
            ->map(fn (object $row): string => "{$row->organization_id}:{$row->role_id}")
            ->all();
    }

    private function auditEvents(string $action, User $user): int
    {
        return DB::table('activity_log')
            ->where('event', $action)
            ->whereNull('organization_id')
            ->where('causer_id', $this->superAdmin->id)
            ->where('properties->user_id', $user->id)
            ->where('properties->email', $user->email)
            ->count();
    }
}
