<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Administration;

use App\Domain\Administration\Models\OrganizationInvitation;
use App\Domain\Authorization\Models\Role;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

final class PlatformInvitationApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_platform_administrators_can_create_list_and_revoke_invitations(): void
    {
        $this->seed(DatabaseSeeder::class);

        $administrator = User::query()->where('email', 'platform-admin@example.test')->firstOrFail();
        $organization = Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail();
        $role = Role::query()->where('organization_id', $organization->id)->where('name', 'member')->firstOrFail();

        $created = $this->actingAs($administrator, 'sanctum')
            ->postJson("/api/v1/admin/organizations/{$organization->uuid}/invitations", [
                'email' => 'invited@example.test',
                'role_ids' => [$role->id],
            ])
            ->assertCreated()
            ->assertJsonPath('data.email', 'invited@example.test')
            ->assertJsonPath('data.organization.uuid', $organization->uuid)
            ->assertJsonPath('data.roles.0.display_name', 'Member');

        $invitationUuid = (string) $created->json('data.uuid');

        $this->actingAs($administrator, 'sanctum')
            ->getJson('/api/v1/admin/invitations')
            ->assertOk()
            ->assertJsonPath('data.0.uuid', $invitationUuid)
            ->assertJsonPath('data.0.status', 'pending');

        $this->actingAs($administrator, 'sanctum')
            ->deleteJson("/api/v1/admin/invitations/{$invitationUuid}")
            ->assertNoContent();

        $this->assertNotNull(OrganizationInvitation::query()->where('uuid', $invitationUuid)->firstOrFail()->revoked_at);
    }

    public function test_super_administrators_can_load_roles_for_an_organization(): void
    {
        $this->seed(DatabaseSeeder::class);

        $superAdmin = User::query()->where('email', 'super-admin@example.test')->firstOrFail();
        $organization = Organization::query()->where('slug', 'northstar-utilities')->firstOrFail();

        $this->actingAs($superAdmin, 'sanctum')
            ->getJson("/api/v1/admin/organizations/{$organization->uuid}/roles")
            ->assertOk()
            ->assertJsonCount(3, 'data')
            ->assertJsonPath('data.0.organization.uuid', $organization->uuid);
    }

    public function test_organization_users_cannot_use_platform_invitation_endpoints(): void
    {
        $this->seed(DatabaseSeeder::class);

        $member = User::query()->where('email', 'acme.member@example.test')->firstOrFail();
        $organization = Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail();

        $this->actingAs($member, 'sanctum')
            ->getJson('/api/v1/admin/invitations')
            ->assertForbidden();

        $this->actingAs($member, 'sanctum')
            ->postJson("/api/v1/admin/organizations/{$organization->uuid}/invitations", [
                'email' => 'invited@example.test',
                'role_ids' => [1],
            ])
            ->assertForbidden();
    }

    public function test_invitation_roles_must_belong_to_the_selected_organization_and_pending_invites_are_replaced(): void
    {
        $this->seed(DatabaseSeeder::class);

        $administrator = User::query()->where('email', 'platform-admin@example.test')->firstOrFail();
        $organization = Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail();
        $memberRole = Role::query()->where('organization_id', $organization->id)->where('name', 'member')->firstOrFail();
        $otherRole = Role::query()->where('organization_id', '!=', $organization->id)->firstOrFail();

        $this->actingAs($administrator, 'sanctum')
            ->postJson("/api/v1/admin/organizations/{$organization->uuid}/invitations", [
                'email' => 'invited@example.test',
                'role_ids' => [$otherRole->id],
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('role_ids');

        $this->actingAs($administrator, 'sanctum')
            ->postJson("/api/v1/admin/organizations/{$organization->uuid}/invitations", [
                'email' => 'invited@example.test',
                'role_ids' => [$memberRole->id],
            ])
            ->assertCreated();

        $this->actingAs($administrator, 'sanctum')
            ->postJson("/api/v1/admin/organizations/{$organization->uuid}/invitations", [
                'email' => 'invited@example.test',
                'role_ids' => [$memberRole->id],
            ])
            ->assertCreated();

        $this->assertSame(
            1,
            OrganizationInvitation::query()
                ->where('organization_id', $organization->id)
                ->where('email', 'invited@example.test')
                ->whereNull('revoked_at')
                ->count(),
        );
    }

    public function test_new_users_can_accept_an_invitation_and_are_authenticated(): void
    {
        $this->seed(DatabaseSeeder::class);

        $organization = Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail();
        $role = Role::query()->where('organization_id', $organization->id)->where('name', 'member')->firstOrFail();
        $token = Str::random(64);

        $invitation = OrganizationInvitation::query()->create([
            'uuid' => (string) Str::uuid(),
            'organization_id' => $organization->id,
            'email' => 'new.user@example.test',
            'role_ids' => [$role->id],
            'token_hash' => hash('sha256', $token),
            'expires_at' => now()->addDays(7),
        ]);

        $this->postJson("/api/v1/invitations/{$token}/accept", [
            'name' => 'New User',
            'password' => 'safe-password',
            'password_confirmation' => 'safe-password',
        ])
            ->assertOk()
            ->assertJsonPath('data.email', 'new.user@example.test');

        $user = User::query()->where('email', 'new.user@example.test')->firstOrFail();

        $this->assertAuthenticatedAs($user, 'web');
        $this->assertTrue($user->organizations()->whereKey($organization->id)->exists());
        $this->assertNotNull($invitation->fresh()->accepted_at);
    }

    public function test_existing_users_must_be_authenticated_as_the_invited_email_before_accepting(): void
    {
        $this->seed(DatabaseSeeder::class);

        $organization = Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail();
        $role = Role::query()->where('organization_id', $organization->id)->where('name', 'member')->firstOrFail();
        $existingUser = User::factory()->create(['email' => 'existing.user@example.test']);
        $otherUser = User::factory()->create(['email' => 'other.user@example.test']);
        $token = Str::random(64);

        OrganizationInvitation::query()->create([
            'uuid' => (string) Str::uuid(),
            'organization_id' => $organization->id,
            'email' => $existingUser->email,
            'role_ids' => [$role->id],
            'token_hash' => hash('sha256', $token),
            'expires_at' => now()->addDays(7),
        ]);

        $this->postJson("/api/v1/invitations/{$token}/accept")
            ->assertUnprocessable()
            ->assertJsonValidationErrors('email');

        $this->actingAs($otherUser)
            ->postJson("/api/v1/invitations/{$token}/accept")
            ->assertUnprocessable()
            ->assertJsonValidationErrors('email');

        $this->actingAs($existingUser)
            ->postJson("/api/v1/invitations/{$token}/accept")
            ->assertOk()
            ->assertJsonPath('data.email', $existingUser->email);

        $this->assertTrue($existingUser->organizations()->whereKey($organization->id)->exists());
    }

    public function test_expired_and_revoked_invitations_are_unavailable(): void
    {
        $this->seed(DatabaseSeeder::class);

        $organization = Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail();
        $role = Role::query()->where('organization_id', $organization->id)->where('name', 'member')->firstOrFail();

        foreach ([now()->subMinute(), now()->addDays(7)] as $index => $expiresAt) {
            $token = Str::random(64);
            $invitation = OrganizationInvitation::query()->create([
                'uuid' => (string) Str::uuid(),
                'organization_id' => $organization->id,
                'email' => "unavailable-{$index}@example.test",
                'role_ids' => [$role->id],
                'token_hash' => hash('sha256', $token),
                'expires_at' => $expiresAt,
                'revoked_at' => $index === 1 ? now() : null,
            ]);

            $this->getJson("/api/v1/invitations/{$token}")->assertNotFound();
            $this->postJson("/api/v1/invitations/{$token}/accept", [
                'name' => 'Unavailable User',
                'password' => 'safe-password',
                'password_confirmation' => 'safe-password',
            ])->assertUnprocessable();

            $this->assertNull($invitation->fresh()->accepted_at);
        }
    }
}
