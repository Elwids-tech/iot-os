<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Audit;

use App\Domain\Administration\Models\OrganizationInvitation;
use App\Domain\Audit\Models\Activity;
use App\Domain\Authorization\Models\Role;
use App\Domain\Dashboards\Services\DashboardDefinition;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Tests\TestCase;

/** Changes that were not audited before spec 024 (US3), each recorded once with what changed. */
final class ActivityRecordingTest extends TestCase
{
    use RefreshDatabase;

    private Organization $acme;

    private Organization $northstar;

    private User $administrator;

    private User $member;

    protected function setUp(): void
    {
        parent::setUp();

        Notification::fake();
        $this->seed(DatabaseSeeder::class);
        $this->acme = Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail();
        $this->northstar = Organization::query()->where('slug', 'northstar-utilities')->firstOrFail();
        $this->administrator = User::query()->where('email', 'shared.operator@example.test')->firstOrFail();
        $this->member = User::query()->where('email', 'acme.member@example.test')->firstOrFail();
    }

    public function test_member_role_changes_and_removals_are_recorded_in_their_organization(): void
    {
        $before = $this->roleNamesOf($this->member);
        $moderator = $this->role('moderator');

        $this->actingAs($this->administrator, 'sanctum')
            ->putJson($this->url("members/{$this->member->id}"), ['role_ids' => [$moderator->id]])
            ->assertOk();

        $changed = $this->sole('organization.member.roles_changed');
        $this->assertSame($this->acme->id, $changed->organization_id);
        $this->assertSame($this->administrator->id, (int) $changed->causer_id);
        $this->assertTrue($changed->subject->is($this->member));
        $this->assertSame($this->member->name, $changed->subject_name);
        $this->assertSame(['attributes' => ['roles' => [$moderator->display_name]], 'old' => ['roles' => $before]], $changed->attribute_changes->toArray());

        $this->actingAs($this->administrator, 'sanctum')
            ->deleteJson($this->url("members/{$this->member->id}"))
            ->assertNoContent();

        $removed = $this->sole('organization.member.removed');
        $this->assertSame($this->acme->id, $removed->organization_id);
        $this->assertSame($this->member->email, $removed->properties['email']);
        $this->assertSame(0, Activity::query()->where('organization_id', $this->northstar->id)->count());
    }

    public function test_role_creation_edits_and_deletion_are_recorded(): void
    {
        $roleId = $this->actingAs($this->administrator, 'sanctum')
            ->postJson($this->url('roles'), ['display_name' => 'Viewers', 'permission_names' => ['Device.view']])
            ->assertCreated()
            ->json('data.id');
        $this->assertSame(['Device.view'], $this->sole('organization.role.created')->properties['permissions']);

        $this->actingAs($this->administrator, 'sanctum')
            ->patchJson($this->url("roles/{$roleId}"), ['display_name' => 'Readers', 'permission_names' => ['Device.view', 'Organization.view']])
            ->assertOk();

        $updated = $this->sole('organization.role.updated');
        $this->assertSame($this->acme->id, $updated->organization_id);
        $this->assertSame([
            'attributes' => ['display_name' => 'Readers', 'permissions' => ['Device.view', 'Organization.view']],
            'old' => ['display_name' => 'Viewers', 'permissions' => ['Device.view']],
        ], $updated->attribute_changes->toArray());

        $this->actingAs($this->administrator, 'sanctum')->deleteJson($this->url("roles/{$roleId}"))->assertNoContent();

        $deleted = $this->sole('organization.role.deleted');
        $this->assertSame('Readers', $deleted->subject_name);
        $this->assertSame($this->acme->id, $deleted->organization_id);
    }

    public function test_invitations_sent_revoked_and_accepted_are_recorded(): void
    {
        $memberRole = $this->role('member');
        $uuid = $this->actingAs($this->administrator, 'sanctum')
            ->postJson($this->url('invitations'), ['email' => 'invited.person@example.test', 'role_ids' => [$memberRole->id]])
            ->assertCreated()
            ->json('data.uuid');

        $sent = $this->sole('organization.invitation.sent');
        $this->assertSame('invited.person@example.test', $sent->subject_name);
        $this->assertSame($uuid, $sent->subject_uuid);
        $this->assertSame([$memberRole->display_name], $sent->properties['roles']);
        $this->assertStringNotContainsString((string) OrganizationInvitation::query()->where('uuid', $uuid)->value('token_hash'), json_encode($sent->toArray()));

        $this->actingAs($this->administrator, 'sanctum')->deleteJson($this->url("invitations/{$uuid}"))->assertNoContent();
        $this->assertSame($this->administrator->id, (int) $this->sole('organization.invitation.revoked')->causer_id);

        $token = Str::random(64);
        OrganizationInvitation::query()->create([
            'uuid' => (string) Str::uuid(), 'organization_id' => $this->acme->id, 'email' => 'new.person@example.test',
            'role_ids' => [$memberRole->id], 'token_hash' => hash('sha256', $token),
            'invited_by_user_id' => $this->administrator->id, 'expires_at' => now()->addDays(7),
        ]);
        $this->app['auth']->forgetGuards();
        $this->postJson("/api/v1/invitations/{$token}/accept", ['name' => 'New Person', 'password' => 'safe-password', 'password_confirmation' => 'safe-password'])->assertOk();

        $accepted = $this->sole('organization.invitation.accepted');
        $this->assertSame(User::query()->where('email', 'new.person@example.test')->value('id'), (int) $accepted->causer_id);
        $this->assertSame($this->acme->id, $accepted->organization_id);
    }

    public function test_platform_administrators_changes_to_an_organization_belong_to_it(): void
    {
        $administrator = User::query()->where('email', 'platform-admin@example.test')->firstOrFail();

        $uuid = $this->actingAs($administrator, 'sanctum')
            ->postJson('/api/v1/admin/organizations', ['name' => 'Cedar Processing', 'slug' => 'cedar-processing'])
            ->assertCreated()
            ->json('data.uuid');
        $cedar = Organization::query()->where('uuid', $uuid)->firstOrFail();
        $this->assertSame($cedar->id, $this->sole('organization.created')->organization_id);

        $this->actingAs($administrator, 'sanctum')
            ->patchJson("/api/v1/admin/organizations/{$uuid}", ['name' => 'Cedar Foods', 'slug' => 'cedar-processing'])
            ->assertOk();

        $updated = $this->sole('organization.updated');
        $this->assertSame($cedar->id, $updated->organization_id);
        $this->assertSame(['attributes' => ['name' => 'Cedar Foods'], 'old' => ['name' => 'Cedar Processing']], $updated->attribute_changes->toArray());
    }

    public function test_dashboard_changes_are_recorded_with_what_changed(): void
    {
        $this->actingAs(User::query()->where('email', 'super-admin@example.test')->firstOrFail(), 'sanctum');
        $url = $this->url('dashboards');
        $document = ['name' => 'Operations', 'widgets' => [], 'layouts' => [], 'defaults' => DashboardDefinition::defaults()];

        $uuid = $this->postJson($url, $document)->assertOk()->json('data.uuid');
        $this->assertSame('Operations', $this->sole('dashboard.created')->subject_name);

        $this->putJson("{$url}/{$uuid}", [...$document, 'name' => 'Plant floor', 'tags' => ['plant'], 'revision' => 1])->assertOk();
        $updated = $this->sole('dashboard.updated');
        $this->assertSame($this->acme->id, $updated->organization_id);
        $this->assertSame(['attributes' => ['name' => 'Plant floor', 'tags' => ['plant']], 'old' => ['name' => 'Operations', 'tags' => []]], $updated->attribute_changes->toArray());

        $this->putJson("{$url}/{$uuid}/access", ['access' => 'restricted', 'shares' => [['type' => 'user', 'id' => $this->member->id, 'level' => 'view']]])->assertOk();
        $access = $this->sole('dashboard.access_changed')->attribute_changes->toArray();
        $this->assertSame(['access' => 'organization', 'shares' => []], $access['old']);
        $this->assertSame(['access' => 'restricted', 'shares' => ["Member {$this->member->name} (view)"]], $access['attributes']);

        $this->deleteJson("{$url}/{$uuid}")->assertNoContent();
        $this->assertSame('Plant floor', $this->sole('dashboard.deleted')->subject_name);
    }

    public function test_device_profile_changes_name_what_changed_in_the_draft(): void
    {
        $this->actingAs($this->administrator, 'sanctum');
        $root = $this->url('device-profiles');
        $uuid = $this->postJson($root, ['code' => 'meter', 'name' => 'Meter', 'category' => 'Energy'])->assertCreated()->json('data.uuid');
        $this->assertSame($uuid, $this->sole('device_profile.created')->subject_uuid);

        $revision = fn (): int => (int) $this->getJson("{$root}/{$uuid}")->json('data.draft_revision');
        $this->postJson("{$root}/{$uuid}/parameters", ['key' => 'voltage', 'label' => 'Voltage', 'kind' => 'measurement', 'data_type' => 'number', 'draft_revision' => $revision()])->assertCreated();

        $draft = $this->sole('device_profile.draft_changed');
        $this->assertSame(['change' => 'parameter.created', 'item' => 'voltage'], array_intersect_key($draft->properties->toArray(), ['change' => 0, 'item' => 0]));
        $this->assertSame($this->acme->id, $draft->organization_id);

        $this->patchJson("{$root}/{$uuid}", ['name' => 'Power meter', 'draft_revision' => $revision()])->assertOk();
        $this->assertSame(['attributes' => ['name' => 'Power meter'], 'old' => ['name' => 'Meter']], $this->sole('device_profile.updated')->attribute_changes->toArray());
    }

    public function test_site_edits_record_what_changed(): void
    {
        $this->actingAs($this->administrator, 'sanctum');
        $uuid = $this->postJson($this->url('sites'), ['name' => 'Yard', 'timezone' => 'UTC'])->assertCreated()->json('data.uuid');

        $this->patchJson($this->url("sites/{$uuid}"), ['name' => 'North yard'])->assertOk();

        $updated = $this->sole('site.updated');
        $this->assertSame($uuid, $updated->subject_uuid);
        $this->assertSame(['attributes' => ['name' => 'North yard'], 'old' => ['name' => 'Yard']], $updated->attribute_changes->toArray());
    }

    private function sole(string $action): Activity
    {
        return Activity::query()->where('event', $action)->sole();
    }

    private function url(string $suffix): string
    {
        return "/api/v1/organizations/{$this->acme->uuid}/{$suffix}";
    }

    private function role(string $name): Role
    {
        return Role::query()->where('organization_id', $this->acme->id)->where('name', $name)->firstOrFail();
    }

    /**
     * @return list<string>
     */
    private function roleNamesOf(User $user): array
    {
        return Role::query()
            ->where('organization_id', $this->acme->id)
            ->whereIn('id', DB::table('model_has_roles')->where('model_id', $user->id)->where('organization_id', $this->acme->id)->pluck('role_id'))
            ->orderBy('display_name')
            ->pluck('display_name')
            ->all();
    }
}
