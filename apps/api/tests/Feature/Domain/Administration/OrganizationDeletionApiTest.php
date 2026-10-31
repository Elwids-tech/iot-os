<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Administration;

use App\Domain\Administration\Models\OrganizationInvitation;
use App\Domain\Assistant\Models\AssistantConversation;
use App\Domain\Authorization\Models\Role;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Automation\Notifications\AlertTransitionNotification;
use App\Domain\Dashboards\Models\Dashboard;
use App\Domain\DeviceAdapters\Models\AdapterTenant;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\Site;
use App\Domain\Devices\Models\SparkplugConnection;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Passport\Passport;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\Agents\AgentFixtures;
use Tests\TestCase;

/** Spec 006: platform administrators permanently delete organizations that hold nothing worth keeping. */
final class OrganizationDeletionApiTest extends TestCase
{
    use AgentFixtures, RefreshDatabase;

    private User $administrator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->administrator = User::query()->where('email', 'platform-admin@example.test')->firstOrFail();
    }

    public function test_an_organization_without_blockers_is_deleted_with_everything_it_holds(): void
    {
        Storage::fake('local');
        $organization = $this->createOrganization('Cedar Processing', 'cedar-processing');
        $acme = Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail();
        $member = User::query()->where('email', 'acme.member@example.test')->firstOrFail();
        $organization->users()->attach($member->id);
        $customRole = (int) $this->actingAs($this->administrator, 'sanctum')
            ->postJson("/api/v1/organizations/{$organization->uuid}/roles", ['display_name' => 'Auditor', 'permission_names' => ['Organization.view']])
            ->assertCreated()
            ->json('data.id');
        $this->actingAs($this->administrator, 'sanctum')
            ->putJson("/api/v1/organizations/{$organization->uuid}/members/{$member->id}", ['role_ids' => [$customRole]])
            ->assertOk();
        $invitation = OrganizationInvitation::query()->create([
            'uuid' => (string) Str::uuid(),
            'organization_id' => $organization->id,
            'email' => 'invitee@cedar.example.test',
            'role_ids' => [$customRole],
            'token_hash' => hash('sha256', $token = Str::random(64)),
            'expires_at' => now()->addDays(7),
        ]);
        Dashboard::create(['organization_id' => $organization->id, 'name' => 'Overview', 'widgets' => [], 'layouts' => []]);
        Site::create(['organization_id' => $organization->id, 'name' => 'North plant', 'timezone' => 'UTC']);
        DB::table('telemetry_retention_settings')->insert(['scope_key' => 'organization:'.$organization->uuid, 'organization_id' => $organization->id, 'days' => 7, 'revision' => 1, 'created_at' => now(), 'updated_at' => now()]);
        DeviceAudit::record('retention.cleanup', $organization->id, null, null);
        DeviceAudit::record('retention.cleanup', $acme->id, null, null);
        $connection = $this->agentConnection($member, $organization);
        $tokens = $this->agentTokenRows($member, (string) $connection->oauth_client_id);
        $acmeConnection = $this->agentConnection($member, $acme);
        $acmeTokens = $this->agentTokenRows($member, (string) $acmeConnection->oauth_client_id);
        $sdk = (string) Str::uuid();
        DB::table('agent_conversations')->insert(['id' => $sdk, 'title' => 'Profile help', 'created_at' => now(), 'updated_at' => now()]);
        $conversation = AssistantConversation::create(['organization_id' => $organization->id, 'user_id' => $member->id, 'sdk_conversation_id' => $sdk]);
        Storage::disk('local')->put("assistant/{$conversation->id}/upload.txt", 'manual');
        $bell = fn (Organization $o) => new AlertTransitionNotification(['organization_uuid' => $o->uuid, 'alert_uuid' => (string) Str::uuid(), 'episode' => 1, 'transition' => 'activated', 'occurred_at' => now()->toIso8601ZuluString(), 'workflow_uuid' => (string) Str::uuid(), 'workflow_name' => 'Door open', 'device_uuid' => null, 'device_name' => null]);
        $member->notify($bell($organization));
        $member->notify($bell($acme));

        $this->actingAs($this->administrator, 'sanctum')
            ->getJson("/api/v1/admin/organizations/{$organization->uuid}/deletion")
            ->assertOk()
            ->assertJsonPath('data.deletable', true)
            ->assertJsonPath('data.blockers', [])
            ->assertJsonFragment(['key' => 'members', 'count' => 1])
            ->assertJsonFragment(['key' => 'roles', 'count' => 4])
            ->assertJsonFragment(['key' => 'invitations', 'count' => 1])
            ->assertJsonFragment(['key' => 'dashboards', 'count' => 1])
            ->assertJsonFragment(['key' => 'sites', 'count' => 1])
            ->assertJsonFragment(['key' => 'agent_connections', 'count' => 1])
            ->assertJsonFragment(['key' => 'assistant_conversations', 'count' => 1])
            ->assertJsonFragment(['key' => 'audit_events', 'count' => 1]);

        $this->actingAs($this->administrator, 'sanctum')
            ->deleteJson("/api/v1/admin/organizations/{$organization->uuid}?slug=cedar-processing")
            ->assertNoContent();

        $this->assertNull(Organization::withTrashed()->find($organization->id));
        foreach (['organization_user', 'roles', 'organization_invitations', 'dashboards', 'sites', 'telemetry_retention_settings', 'activity_log', 'agent_connections', 'assistant_conversations'] as $table) {
            $this->assertSame(0, DB::table($table)->where('organization_id', $organization->id)->count(), $table);
        }
        $this->assertNull(Role::query()->find($customRole));
        $this->assertFalse(DB::table('agent_conversations')->where('id', $sdk)->exists());
        // Bell notifications (spec 022) link to their organization inside `data`, with no key to cascade.
        $this->assertSame([$acme->uuid], DB::table('notifications')->pluck('data')->map(fn ($data) => json_decode($data, true)['organization_uuid'])->all());
        Storage::disk('local')->assertMissing("assistant/{$conversation->id}/upload.txt");

        // The member keeps their account and their other memberships, roles and agent.
        $this->assertTrue($member->fresh()->organizations()->whereKey($acme->id)->exists());
        $this->assertTrue((bool) Passport::token()->newQuery()->findOrFail($tokens['access'])->revoked);
        $this->assertTrue((bool) Passport::refreshToken()->newQuery()->findOrFail($tokens['refresh'])->revoked);
        $this->assertFalse((bool) Passport::token()->newQuery()->findOrFail($acmeTokens['access'])->revoked);
        $this->assertNull($acmeConnection->fresh()->revoked_at);
        $this->assertSame(1, DB::table('activity_log')->where('organization_id', $acme->id)->where('event', 'retention.cleanup')->count());

        $this->getJson("/api/v1/invitations/{$token}")->assertNotFound();
        $this->assertFalse(OrganizationInvitation::query()->whereKey($invitation->id)->exists());

        $event = DB::table('activity_log')->where('event', 'organization.deleted')->sole();
        $this->assertNull($event->organization_id);
        $this->assertSame($this->administrator->id, (int) $event->causer_id);
        $this->assertSame($organization->uuid, $event->subject_uuid);
        $this->assertSame(['name' => 'Cedar Processing', 'slug' => 'cedar-processing'], json_decode($event->properties, true));

        // The slug is free again.
        $this->createOrganization('Cedar Processing', 'cedar-processing');
    }

    /**
     * @return iterable<string, array{0: \Closure(Organization): void, 1: string}>
     */
    public static function blockers(): iterable
    {
        yield 'an archived device' => [fn (Organization $o) => Device::create(['organization_id' => $o->id, 'code' => 'pump-1', 'name' => 'Pump', 'lifecycle' => 'archived']), 'devices'];
        yield 'a broker connection' => [fn (Organization $o) => self::connection($o), 'broker_connections'];
        yield 'a gateway' => [fn (Organization $o) => SparkplugGateway::create(['organization_id' => $o->id, 'sparkplug_connection_id' => self::connection($o)->id, 'name' => 'Gateway', 'edge_node_id' => 'edge']), 'gateways'];
        yield 'an adapter runtime' => [fn (Organization $o) => AdapterTenant::create(['organization_id' => $o->id, 'listen_port' => 18883, 'runtime_token' => Str::random(64), 'ingress_admin_password' => Str::random(64)]), 'adapter_runtimes'];
        yield 'a soft-deleted device profile' => [fn (Organization $o) => DeviceProfile::create(['organization_id' => $o->id, 'code' => 'meter', 'name' => 'Meter'])->delete(), 'device_profiles'];
        yield 'a draft automation' => [fn (Organization $o) => Workflow::create(['organization_id' => $o->id, 'name' => 'Too hot', 'workflow' => [], 'definition' => [], 'definition_hash' => str_repeat('a', 64), 'updated_by' => User::query()->value('id')]), 'automations'];
    }

    /**
     * @param  \Closure(Organization): void  $create
     */
    #[DataProvider('blockers')]
    public function test_blockers_are_reported_and_refuse_the_delete(\Closure $create, string $key): void
    {
        $organization = $this->createOrganization('Birch Mills', 'birch-mills');
        $create($organization);

        $this->actingAs($this->administrator, 'sanctum')
            ->getJson("/api/v1/admin/organizations/{$organization->uuid}/deletion")
            ->assertOk()
            ->assertJsonPath('data.deletable', false)
            ->assertJsonFragment(['key' => $key, 'count' => 1]);

        $refused = $this->actingAs($this->administrator, 'sanctum')
            ->deleteJson("/api/v1/admin/organizations/{$organization->uuid}?slug=birch-mills")
            ->assertStatus(409);
        $this->assertContains($key, array_column($refused->json('blockers'), 'key'));

        $this->assertNotNull(Organization::query()->find($organization->id));
        $this->assertSame(3, Role::query()->where('organization_id', $organization->id)->count());
    }

    public function test_an_assistant_reply_in_progress_blocks_until_it_stops(): void
    {
        $organization = $this->createOrganization('Birch Mills', 'birch-mills');
        $conversation = AssistantConversation::create(['organization_id' => $organization->id, 'user_id' => $this->administrator->id]);
        $run = $conversation->runs()->create(['request_id' => (string) Str::uuid(), 'status' => 'running', 'prompt' => 'Help', 'reserved_usd' => 0.25]);

        $this->actingAs($this->administrator, 'sanctum')
            ->deleteJson("/api/v1/admin/organizations/{$organization->uuid}?slug=birch-mills")
            ->assertStatus(409)
            ->assertJsonPath('blockers.0.key', 'assistant_runs');

        $run->forceFill(['reserved_usd' => 0])->save();

        $this->actingAs($this->administrator, 'sanctum')
            ->deleteJson("/api/v1/admin/organizations/{$organization->uuid}?slug=birch-mills")
            ->assertNoContent();
    }

    public function test_seeded_organizations_with_devices_list_their_blockers(): void
    {
        $acme = Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail();
        Device::create(['organization_id' => $acme->id, 'code' => 'boiler-1', 'name' => 'Boiler']);

        $this->actingAs($this->administrator, 'sanctum')
            ->getJson('/api/v1/admin/organizations?search=acme')
            ->assertOk()
            ->assertJsonPath('data.0.devices_count', 1);

        $this->actingAs($this->administrator, 'sanctum')
            ->getJson("/api/v1/admin/organizations/{$acme->uuid}/deletion")
            ->assertOk()
            ->assertJsonPath('data.deletable', false)
            ->assertJsonFragment(['key' => 'devices', 'label' => 'Devices', 'count' => 1]);
    }

    public function test_the_slug_must_be_repeated_and_only_platform_administrators_may_delete(): void
    {
        $organization = $this->createOrganization('Birch Mills', 'birch-mills');
        $tenantAdministrator = User::query()->where('email', 'shared.operator@example.test')->firstOrFail();
        $organization->users()->attach($tenantAdministrator->id);

        $this->actingAs($this->administrator, 'sanctum')
            ->deleteJson("/api/v1/admin/organizations/{$organization->uuid}?slug=Birch%20Mills")
            ->assertUnprocessable()
            ->assertJsonValidationErrors('slug');
        $this->actingAs($this->administrator, 'sanctum')
            ->deleteJson("/api/v1/admin/organizations/{$organization->uuid}")
            ->assertUnprocessable()
            ->assertJsonValidationErrors('slug');

        $this->actingAs($tenantAdministrator, 'sanctum')
            ->getJson("/api/v1/admin/organizations/{$organization->uuid}/deletion")
            ->assertForbidden();
        $this->actingAs($tenantAdministrator, 'sanctum')
            ->deleteJson("/api/v1/admin/organizations/{$organization->uuid}?slug=birch-mills")
            ->assertForbidden();

        $this->assertNotNull(Organization::query()->find($organization->id));

        $this->actingAs($this->administrator, 'sanctum')
            ->deleteJson('/api/v1/admin/organizations/'.Str::uuid().'?slug=birch-mills')
            ->assertNotFound();
    }

    public function test_the_billing_account_keeps_a_deleted_organizations_closed_assignment(): void
    {
        $organization = $this->createOrganization('Birch Mills', 'birch-mills');
        $accountId = $organization->billing_account_id;

        $this->actingAs($this->administrator, 'sanctum')
            ->deleteJson('/api/v1/admin/organizations/'.$organization->uuid.'?slug=birch-mills')
            ->assertNoContent();

        $assignment = DB::table('billing_account_assignments')->where('organization_uuid', $organization->uuid)->sole();
        $this->assertNull($assignment->organization_id);
        $this->assertSame($accountId, (int) $assignment->billing_account_id);
        $this->assertSame('Birch Mills', $assignment->organization_name);
        $this->assertNotNull($assignment->ended_at);
        $this->assertSame($this->administrator->id, (int) $assignment->ended_by);
    }

    private function createOrganization(string $name, string $slug): Organization
    {
        $uuid = $this->actingAs($this->administrator, 'sanctum')
            ->postJson('/api/v1/admin/organizations', ['name' => $name, 'slug' => $slug])
            ->assertCreated()
            ->json('data.uuid');

        return Organization::query()->where('uuid', $uuid)->firstOrFail();
    }

    private static function connection(Organization $organization): SparkplugConnection
    {
        return SparkplugConnection::create(['organization_id' => $organization->id, 'name' => 'Connection', 'group_id' => 'plant', 'host_id' => 'plant', 'username' => 'plant-'.$organization->id, 'password' => 'test-secret', 'status' => 'ready']);
    }
}
