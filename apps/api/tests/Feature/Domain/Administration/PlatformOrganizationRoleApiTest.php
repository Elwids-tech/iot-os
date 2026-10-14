<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Administration;

use App\Domain\Administration\Notifications\OrganizationInvitationNotification;
use App\Domain\Authorization\Models\Role;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Notifications\AnonymousNotifiable;
use Illuminate\Support\Facades\Notification;
use Spatie\Permission\PermissionRegistrar;
use Tests\TestCase;

/**
 * The admin app creates, renames and deletes organization roles through the
 * organization routes; platform administrators need no membership there.
 */
final class PlatformOrganizationRoleApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_platform_administrators_create_an_organization_then_a_role_then_invite_with_it(): void
    {
        Notification::fake();
        $this->seed(DatabaseSeeder::class);
        $administrator = User::query()->where('email', 'platform-admin@example.test')->firstOrFail();

        $uuid = (string) $this->actingAs($administrator, 'sanctum')
            ->postJson('/api/v1/admin/organizations', ['name' => 'Cedar Processing', 'slug' => 'cedar-processing'])
            ->assertCreated()
            ->json('data.uuid');
        $organization = Organization::query()->where('uuid', $uuid)->firstOrFail();
        $this->assertFalse($administrator->organizations()->whereKey($organization->id)->exists());

        $this->actingAs($administrator, 'sanctum')
            ->getJson("/api/v1/organizations/{$uuid}/role-permissions")
            ->assertOk()
            ->assertJsonPath('data.0.grantable', true);

        $roleId = (int) $this->actingAs($administrator, 'sanctum')
            ->postJson("/api/v1/organizations/{$uuid}/roles", [
                'display_name' => 'Site Operator',
                'permission_names' => ['Organization.view', 'User.view-any'],
            ])
            ->assertCreated()
            ->assertJsonPath('data.display_name', 'Site Operator')
            ->assertJsonPath('data.is_default', false)
            ->assertJsonPath('data.manageable', true)
            ->json('data.id');

        $this->actingAs($administrator, 'sanctum')
            ->getJson("/api/v1/admin/roles?organization={$uuid}&search=Site")
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $roleId)
            ->assertJsonPath('data.0.permissions_count', 2);

        $this->actingAs($administrator, 'sanctum')
            ->postJson("/api/v1/admin/organizations/{$uuid}/invitations", [
                'email' => 'operator@cedar.example.test',
                'role_ids' => [$roleId],
            ])
            ->assertCreated()
            ->assertJsonPath('data.roles.0.display_name', 'Site Operator');

        $token = null;
        Notification::assertSentOnDemand(
            OrganizationInvitationNotification::class,
            function (OrganizationInvitationNotification $notification) use (&$token): bool {
                parse_str((string) parse_url($notification->toMail(new AnonymousNotifiable)->actionUrl, PHP_URL_QUERY), $query);
                $token = $query['token'] ?? null;

                return is_string($token);
            },
        );

        $this->app['auth']->forgetGuards();
        $this->postJson("/api/v1/invitations/{$token}/accept", [
            'name' => 'Cedar Operator',
            'password' => 'safe-password',
            'password_confirmation' => 'safe-password',
        ])->assertOk();

        $member = User::query()->where('email', 'operator@cedar.example.test')->firstOrFail();
        $registrar = app(PermissionRegistrar::class);
        $registrar->setPermissionsTeamId($organization->id);
        $this->assertTrue($member->fresh()->hasRole(Role::query()->findOrFail($roleId)));
        $this->assertTrue($member->fresh()->hasPermissionTo('User.view-any'));
        $this->assertFalse($member->fresh()->hasPermissionTo('Role.create'));
        $registrar->setPermissionsTeamId(null);
    }

    public function test_platform_administrators_rename_and_delete_custom_roles_only_when_unused(): void
    {
        $this->seed(DatabaseSeeder::class);
        $administrator = User::query()->where('email', 'platform-admin@example.test')->firstOrFail();
        $organization = Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail();
        $member = User::query()->where('email', 'acme.member@example.test')->firstOrFail();
        $base = "/api/v1/organizations/{$organization->uuid}/roles";

        $roleId = (int) $this->actingAs($administrator, 'sanctum')
            ->postJson($base, ['display_name' => 'Auditor', 'permission_names' => ['Organization.view']])
            ->assertCreated()
            ->json('data.id');

        $this->actingAs($administrator, 'sanctum')
            ->patchJson("{$base}/{$roleId}", ['display_name' => 'Moderator', 'permission_names' => ['Organization.view']])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('display_name');

        $this->actingAs($administrator, 'sanctum')
            ->patchJson("{$base}/{$roleId}", ['display_name' => 'Read-only Auditor', 'permission_names' => ['Organization.view']])
            ->assertOk()
            ->assertJsonPath('data.display_name', 'Read-only Auditor')
            ->assertJsonPath('data.permissions.0.name', 'Organization.view');

        $this->actingAs($administrator, 'sanctum')
            ->putJson("/api/v1/organizations/{$organization->uuid}/members/{$member->id}", ['role_ids' => [$roleId]])
            ->assertOk();

        $this->actingAs($administrator, 'sanctum')
            ->deleteJson("{$base}/{$roleId}")
            ->assertUnprocessable()
            ->assertJsonValidationErrors('role');

        $memberRole = Role::query()->where('organization_id', $organization->id)->where('name', 'member')->firstOrFail();
        $this->actingAs($administrator, 'sanctum')
            ->putJson("/api/v1/organizations/{$organization->uuid}/members/{$member->id}", ['role_ids' => [$memberRole->id]])
            ->assertOk();

        $this->actingAs($administrator, 'sanctum')
            ->deleteJson("{$base}/{$roleId}")
            ->assertNoContent();
        $this->assertNull(Role::query()->find($roleId));

        $this->actingAs($administrator, 'sanctum')
            ->deleteJson("{$base}/{$memberRole->id}")
            ->assertUnprocessable()
            ->assertJsonValidationErrors('role');
    }

    public function test_roles_stay_inside_the_organization_and_its_ceiling(): void
    {
        $this->seed(DatabaseSeeder::class);
        $administrator = User::query()->where('email', 'platform-admin@example.test')->firstOrFail();
        $acme = Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail();
        $northstar = Organization::query()->where('slug', 'northstar-utilities')->firstOrFail();

        $this->actingAs($administrator, 'sanctum')
            ->postJson("/api/v1/organizations/{$acme->uuid}/roles", [
                'display_name' => 'Escalation Attempt',
                'permission_names' => ['PlatformAdministration.access'],
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('permission_names');

        $acmeRole = Role::query()->where('organization_id', $acme->id)->where('name', 'member')->firstOrFail();
        $this->actingAs($administrator, 'sanctum')
            ->deleteJson("/api/v1/organizations/{$northstar->uuid}/roles/{$acmeRole->id}")
            ->assertNotFound();

        $acmeOnlyMember = User::query()->where('email', 'acme.member@example.test')->firstOrFail();
        $this->actingAs($acmeOnlyMember, 'sanctum')
            ->postJson("/api/v1/organizations/{$northstar->uuid}/roles", [
                'display_name' => 'Intruder',
                'permission_names' => [],
            ])
            ->assertForbidden();
        $this->assertFalse(Role::query()->where('display_name', 'Intruder')->exists());
    }
}
