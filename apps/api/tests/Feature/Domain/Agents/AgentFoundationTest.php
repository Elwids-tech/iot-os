<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Agents;

use App\Domain\Agents\Enums\ProposalStatus;
use App\Domain\Agents\Enums\RevocationReason;
use App\Domain\Agents\Models\AgentActivity;
use App\Domain\Agents\Models\AgentProposal;
use App\Domain\Agents\Models\AgentProposalGroup;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Laravel\Passport\Contracts\OAuthenticatable;
use Laravel\Passport\HasApiTokens as PassportTokens;
use Laravel\Passport\Passport;
use Laravel\Sanctum\HasApiTokens as SanctumTokens;
use Spatie\Permission\Models\Permission;
use Tests\Support\Agents\AgentFixtures;
use Tests\TestCase;

final class AgentFoundationTest extends TestCase
{
    use AgentFixtures, RefreshDatabase;

    public function test_people_hold_passport_tokens_and_the_agent_guard_carries_no_permissions(): void
    {
        $traits = class_uses_recursive(User::class);
        $this->assertContains(PassportTokens::class, $traits);
        $this->assertNotContains(SanctumTokens::class, $traits);
        $this->assertInstanceOf(OAuthenticatable::class, new User);
        $this->assertSame('passport', config('auth.guards.mcp.driver'));

        $this->seed(DatabaseSeeder::class);
        $this->assertSame(0, Permission::where('guard_name', 'mcp')->count());
        $this->assertGreaterThan(0, Permission::where('guard_name', 'web')->count());
    }

    public function test_passport_registers_none_of_its_default_routes(): void
    {
        foreach (['passport.token', 'passport.authorizations.authorize', 'passport.authorizations.approve', 'passport.clients.index', 'passport.device'] as $name) {
            $this->assertFalse(Route::has($name), "{$name} must not be registered");
        }
    }

    public function test_removing_a_member_revokes_their_connections_to_that_organization_only(): void
    {
        $this->seed(DatabaseSeeder::class);
        $acme = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $shared = User::where('email', 'shared.operator@example.test')->firstOrFail();
        $inAcme = $this->agentConnection($shared, $acme);
        $inNorthstar = $this->agentConnection($shared, $northstar);
        $tokens = $this->agentTokenRows($shared, (string) $inNorthstar->oauth_client_id);
        $northstarAdmin = User::where('email', 'northstar.admin@example.test')->firstOrFail();

        $this->actingAs($northstarAdmin)->deleteJson('/api/v1/organizations/'.$northstar->uuid.'/members/'.$shared->id)->assertNoContent();

        $this->assertSame(RevocationReason::MEMBERSHIP_REMOVED, $inNorthstar->fresh()->revoked_reason);
        $this->assertSame($northstarAdmin->id, $inNorthstar->fresh()->revoked_by_user_id);
        $this->assertTrue((bool) Passport::token()->newQuery()->findOrFail($tokens['access'])->revoked);
        $this->assertTrue((bool) Passport::refreshToken()->newQuery()->findOrFail($tokens['refresh'])->revoked);
        $this->assertNull($inAcme->fresh()->revoked_at);
    }

    public function test_pruning_removes_unused_clients_and_old_activity_and_expires_proposals(): void
    {
        $user = User::factory()->create();
        $organization = Organization::factory()->create();
        $unused = $this->agentClient('Never connected');
        $unused->forceFill(['created_at' => now()->subDay()->subMinute()])->save();
        $recent = $this->agentClient('Still deciding');
        $connection = $this->agentConnection($user, $organization);
        $connection->client->forceFill(['created_at' => now()->subWeek()])->save();
        $old = AgentActivity::create(['agent_connection_id' => $connection->id, 'organization_id' => $organization->id, 'user_id' => $user->id, 'tool' => 'find_devices', 'targets' => [], 'outcome' => 'answered', 'duration_ms' => 5, 'created_at' => now()->subDays(91)]);
        $kept = AgentActivity::create(['agent_connection_id' => $connection->id, 'organization_id' => $organization->id, 'user_id' => $user->id, 'tool' => 'find_devices', 'targets' => [], 'outcome' => 'answered', 'duration_ms' => 5, 'created_at' => now()->subDays(89)]);
        $group = AgentProposalGroup::create(['agent_connection_id' => $connection->id, 'organization_id' => $organization->id, 'user_id' => $user->id, 'title' => 'Onboard a meter']);
        $proposal = fn (string $expires) => AgentProposal::create(['agent_proposal_group_id' => $group->id, 'kind' => 'dashboard', 'summary' => 'A dashboard', 'payload' => [], 'content_hash' => str_repeat('a', 64), 'expires_at' => $expires]);
        $stale = $proposal(now()->subMinute()->toDateTimeString());
        $fresh = $proposal(now()->addDay()->toDateTimeString());

        $this->artisan('agents:prune')->assertSuccessful();

        $this->assertNull(Passport::client()->newQuery()->find($unused->id));
        $this->assertNotNull(Passport::client()->newQuery()->find($recent->id));
        $this->assertNotNull(Passport::client()->newQuery()->find($connection->oauth_client_id));
        $this->assertNull(AgentActivity::find($old->id));
        $this->assertNotNull(AgentActivity::find($kept->id));
        $this->assertSame(ProposalStatus::EXPIRED, $stale->fresh()->status);
        $this->assertSame(ProposalStatus::OPEN, $fresh->fresh()->status);
    }
}
