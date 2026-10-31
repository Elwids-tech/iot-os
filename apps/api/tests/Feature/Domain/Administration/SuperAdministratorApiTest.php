<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Administration;

use App\Domain\Administration\Models\OrganizationInvitation;
use App\Domain\Administration\Notifications\OrganizationInvitationNotification;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Super administrators grant, remove and invite super administrators (spec 007).
 */
final class SuperAdministratorApiTest extends TestCase
{
    use RefreshDatabase;

    private User $superAdmin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(DatabaseSeeder::class);
        $this->superAdmin = User::query()->where('email', 'super-admin@example.test')->firstOrFail();
    }

    public function test_super_administrators_grant_access_to_an_existing_user_who_keeps_their_memberships(): void
    {
        $member = User::query()->where('email', 'acme.member@example.test')->firstOrFail();
        $organizations = $member->organizations()->pluck('organizations.id')->all();

        $this->actingAs($this->superAdmin, 'sanctum')
            ->putJson("/api/v1/admin/super-administrators/{$member->id}")
            ->assertOk()
            ->assertJsonPath('data.id', $member->id)
            ->assertJsonPath('data.is_super_admin', true);

        $this->assertTrue($member->fresh()->is_super_admin);
        $this->assertSame($organizations, $member->organizations()->pluck('organizations.id')->all());
        $this->assertSame(1, $this->auditEvents('user.super_admin_granted', $member));

        // Repeating it changes nothing and records nothing.
        $this->actingAs($this->superAdmin, 'sanctum')
            ->putJson("/api/v1/admin/super-administrators/{$member->id}")
            ->assertOk();
        $this->assertSame(1, $this->auditEvents('user.super_admin_granted', $member));
    }

    public function test_super_administrators_remove_another_super_administrators_access(): void
    {
        $other = User::factory()->create(['is_super_admin' => true]);

        $this->actingAs($this->superAdmin, 'sanctum')
            ->deleteJson("/api/v1/admin/super-administrators/{$other->id}")
            ->assertNoContent();

        $this->assertFalse($other->fresh()->is_super_admin);
        $this->assertSame(1, $this->auditEvents('user.super_admin_revoked', $other));

        $this->actingAs($this->superAdmin, 'sanctum')
            ->deleteJson("/api/v1/admin/super-administrators/{$other->id}")
            ->assertNoContent();
        $this->assertSame(1, $this->auditEvents('user.super_admin_revoked', $other));

        // The next request is authorized without the access.
        $this->actingAs($other->fresh(), 'sanctum')
            ->getJson('/api/v1/admin/users')
            ->assertForbidden();
    }

    public function test_super_administrators_cannot_remove_their_own_access(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')
            ->deleteJson("/api/v1/admin/super-administrators/{$this->superAdmin->id}")
            ->assertUnprocessable()
            ->assertJsonValidationErrors('user');

        $this->assertTrue($this->superAdmin->fresh()->is_super_admin);
    }

    public function test_an_actor_removed_in_the_meantime_is_refused_under_the_lock(): void
    {
        $other = User::factory()->create(['is_super_admin' => true]);
        // Another request removed this actor's access after they were authenticated.
        DB::table('users')->where('id', $other->id)->update(['is_super_admin' => false]);

        $this->actingAs($other, 'sanctum')
            ->deleteJson("/api/v1/admin/super-administrators/{$this->superAdmin->id}")
            ->assertForbidden();

        $this->assertTrue($this->superAdmin->fresh()->is_super_admin);
    }

    public function test_only_super_administrators_manage_super_administrator_access(): void
    {
        Notification::fake();
        $target = User::query()->where('email', 'acme.member@example.test')->firstOrFail();
        $invitation = $this->superAdministratorInvitation('pending@example.test', Str::random(64));

        foreach (['platform-admin@example.test', 'acme.member@example.test'] as $email) {
            $actor = User::query()->where('email', $email)->firstOrFail();
            $this->assertFalse($actor->is_super_admin);

            $this->actingAs($actor, 'sanctum')
                ->putJson("/api/v1/admin/super-administrators/{$target->id}")
                ->assertForbidden();
            $this->actingAs($actor, 'sanctum')
                ->deleteJson("/api/v1/admin/super-administrators/{$this->superAdmin->id}")
                ->assertForbidden();
            $this->actingAs($actor, 'sanctum')
                ->postJson('/api/v1/admin/super-administrators/invitations', ['email' => 'someone@example.test'])
                ->assertForbidden();
            $this->actingAs($actor, 'sanctum')
                ->deleteJson("/api/v1/admin/invitations/{$invitation->uuid}")
                ->assertForbidden();
        }

        $this->assertFalse($target->fresh()->is_super_admin);
        $this->assertTrue($this->superAdmin->fresh()->is_super_admin);
        $this->assertNull($invitation->fresh()->revoked_at);
        Notification::assertNothingSent();
    }

    public function test_super_administrators_invite_list_and_revoke_super_administrator_invitations(): void
    {
        Notification::fake();
        $administrator = User::query()->where('email', 'platform-admin@example.test')->firstOrFail();

        $first = $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/v1/admin/super-administrators/invitations', ['email' => 'New.Admin@Example.test'])
            ->assertCreated()
            ->assertJsonPath('data.email', 'new.admin@example.test')
            ->assertJsonPath('data.grants_super_admin', true)
            ->assertJsonPath('data.organization', null)
            ->assertJsonPath('data.role_ids', [])
            ->assertJsonPath('data.status', 'pending')
            ->json('data.uuid');

        // Inviting again replaces the pending invitation.
        $second = $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/v1/admin/super-administrators/invitations', ['email' => 'new.admin@example.test'])
            ->assertCreated()
            ->json('data.uuid');

        $this->assertNotNull(OrganizationInvitation::query()->where('uuid', $first)->firstOrFail()->revoked_at);
        Notification::assertSentOnDemandTimes(OrganizationInvitationNotification::class, 2);

        // Platform administrators see it in the list.
        $listed = collect($this->actingAs($administrator, 'sanctum')
            ->getJson('/api/v1/admin/invitations')
            ->assertOk()
            ->json('data'))
            ->firstWhere('uuid', $second);
        $this->assertNotNull($listed);
        $this->assertTrue($listed['grants_super_admin']);
        $this->assertNull($listed['organization']);
        $this->assertSame([], $listed['roles']);
        $this->assertSame('pending', $listed['status']);

        $this->actingAs($this->superAdmin, 'sanctum')
            ->deleteJson("/api/v1/admin/invitations/{$second}")
            ->assertNoContent();

        $this->assertNotNull(OrganizationInvitation::query()->where('uuid', $second)->firstOrFail()->revoked_at);
    }

    public function test_an_existing_super_administrator_cannot_be_invited(): void
    {
        Notification::fake();

        $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/v1/admin/super-administrators/invitations', ['email' => 'SUPER-ADMIN@example.test'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('email');

        Notification::assertNothingSent();
    }

    public function test_a_new_person_accepts_and_becomes_a_super_administrator_without_a_membership(): void
    {
        $token = Str::random(64);
        $invitation = $this->superAdministratorInvitation('new.admin@example.test', $token);

        $this->getJson("/api/v1/invitations/{$token}")
            ->assertOk()
            ->assertJsonPath('data.grants_super_admin', true)
            ->assertJsonPath('data.organization', null)
            ->assertJsonPath('data.acceptance_mode', 'create_account');

        $this->postJson("/api/v1/invitations/{$token}/accept", [
            'name' => 'New Admin',
            'password' => 'safe-password',
            'password_confirmation' => 'safe-password',
        ])
            ->assertOk()
            ->assertJsonPath('data.is_super_admin', true)
            ->assertJsonPath('data.capabilities.platform_administration', true);

        $user = User::query()->where('email', 'new.admin@example.test')->firstOrFail();
        $this->assertAuthenticatedAs($user, 'web');
        $this->assertTrue($user->is_super_admin);
        $this->assertSame(0, $user->organizations()->count());
        $this->assertNotNull($invitation->fresh()->accepted_at);
        $this->assertTrue(DB::table('activity_log')
            ->where('event', 'user.super_admin_granted')
            ->whereNull('organization_id')
            ->where('causer_id', $this->superAdmin->id)
            ->where('properties->user_id', $user->id)
            ->where('properties->invitation_uuid', $invitation->uuid)
            ->exists());
    }

    public function test_an_existing_account_accepts_signed_in_and_keeps_its_memberships(): void
    {
        $member = User::query()->where('email', 'acme.member@example.test')->firstOrFail();
        $organizations = $member->organizations()->pluck('organizations.id')->all();
        $token = Str::random(64);
        $this->superAdministratorInvitation($member->email, $token);

        $this->getJson("/api/v1/invitations/{$token}")->assertJsonPath('data.acceptance_mode', 'sign_in');
        $this->postJson("/api/v1/invitations/{$token}/accept")
            ->assertUnprocessable()
            ->assertJsonValidationErrors('email');

        $this->actingAs($member)
            ->postJson("/api/v1/invitations/{$token}/accept")
            ->assertOk()
            ->assertJsonPath('data.is_super_admin', true);

        $this->assertTrue($member->fresh()->is_super_admin);
        $this->assertSame($organizations, $member->organizations()->pluck('organizations.id')->all());
    }

    public function test_invitations_from_someone_who_lost_access_stop_working(): void
    {
        $inviter = User::factory()->create(['is_super_admin' => true]);
        $token = Str::random(64);
        $invitation = $this->superAdministratorInvitation('new.admin@example.test', $token, $inviter);

        $this->actingAs($this->superAdmin, 'sanctum')
            ->deleteJson("/api/v1/admin/super-administrators/{$inviter->id}")
            ->assertNoContent();
        $this->app['auth']->forgetGuards();

        $this->getJson("/api/v1/invitations/{$token}")->assertNotFound();
        $this->postJson("/api/v1/invitations/{$token}/accept", [
            'name' => 'New Admin',
            'password' => 'safe-password',
            'password_confirmation' => 'safe-password',
        ])->assertUnprocessable()->assertJsonValidationErrors('token');

        $this->assertNull($invitation->fresh()->accepted_at);
        $this->assertFalse(User::query()->where('email', 'new.admin@example.test')->exists());
    }

    public function test_organization_invitations_are_unchanged_by_super_administrator_invitations(): void
    {
        Notification::fake();
        $organization = Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail();
        $roleId = (int) DB::table('roles')->where('organization_id', $organization->id)->where('name', 'member')->value('id');

        $organizationInvitation = $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson("/api/v1/admin/organizations/{$organization->uuid}/invitations", [
                'email' => 'both@example.test',
                'role_ids' => [$roleId],
            ])
            ->assertCreated()
            ->assertJsonPath('data.grants_super_admin', false)
            ->assertJsonPath('data.organization.uuid', $organization->uuid)
            ->json('data.uuid');

        $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/v1/admin/super-administrators/invitations', ['email' => 'both@example.test'])
            ->assertCreated();

        $this->assertNull(OrganizationInvitation::query()->where('uuid', $organizationInvitation)->firstOrFail()->revoked_at);

        // The organization's own invitation list never shows the super-administrator invitation.
        $this->actingAs($this->superAdmin, 'sanctum')
            ->getJson("/api/v1/organizations/{$organization->uuid}/invitations")
            ->assertOk()
            ->assertJsonMissing(['grants_super_admin' => true]);
    }

    public function test_an_organization_invitation_cannot_drop_its_organization(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            $this->markTestSkipped('The check constraint exists on PostgreSQL only.');
        }

        $this->expectException(QueryException::class);

        $this->superAdministratorInvitation('broken@example.test', Str::random(64))
            ->forceFill(['grants_super_admin' => false])
            ->save();
    }

    private function superAdministratorInvitation(string $email, string $token, ?User $inviter = null): OrganizationInvitation
    {
        return OrganizationInvitation::query()->create([
            'uuid' => (string) Str::uuid(),
            'organization_id' => null,
            'grants_super_admin' => true,
            'email' => $email,
            'role_ids' => [],
            'token_hash' => hash('sha256', $token),
            'invited_by_user_id' => ($inviter ?? $this->superAdmin)->id,
            'expires_at' => now()->addDays(7),
        ]);
    }

    private function auditEvents(string $action, User $user): int
    {
        return DB::table('activity_log')
            ->where('event', $action)
            ->whereNull('organization_id')
            ->where('causer_id', $this->superAdmin->id)
            ->where('properties->user_id', $user->id)
            ->count();
    }
}
