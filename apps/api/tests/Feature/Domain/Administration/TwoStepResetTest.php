<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Administration;

use App\Domain\Audit\Models\Activity;
use App\Domain\Authentication\Models\KeptSignIn;
use App\Domain\Authentication\Notifications\SecurityChanged;
use App\Domain\Authorization\Models\PlatformRole;
use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Testing\TestResponse;
use Spatie\Permission\Models\Permission;
use Tests\Support\TwoStepFixtures;
use Tests\Support\TwoStepResetFixtures;
use Tests\TestCase;

/** A platform administrator resets a locked-out person's two-step sign-in (spec 034, US4, FR-024, FR-025, FR-027, FR-028). */
final class TwoStepResetTest extends TestCase
{
    use RefreshDatabase, TwoStepFixtures, TwoStepResetFixtures;

    private User $administrator;

    private User $member;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ValidateCsrfToken::class);
        Notification::fake();
        $this->administrator = $this->platformStaff([
            PlatformAdministrationPermission::ACCESS,
            PlatformAdministrationPermission::MANAGE_ORGANIZATIONS,
            PlatformAdministrationPermission::RESET_TWO_STEP,
        ], ['email' => 'platform-staff@example.test']);
        $this->member = User::factory()->create(['email' => 'member@example.test']);
    }

    public function test_the_reset_removes_two_step_and_passkeys_and_ends_every_sign_in(): void
    {
        config(['session.driver' => 'database']);
        $this->turnOnTwoStep($this->member);
        $this->givePasskeys($this->member, 2);
        $other = User::factory()->create();
        $this->givePasskeys($other, 1);
        [$kept] = KeptSignIn::issue($this->member, 'Chrome on Android');
        [$othersKept] = KeptSignIn::issue($other, 'Chrome on Android');
        DB::table('sessions')->insert([
            ['id' => 'member-browser', 'user_id' => $this->member->id, 'payload' => '', 'last_activity' => time()],
            ['id' => 'someone-else', 'user_id' => $other->id, 'payload' => '', 'last_activity' => time()],
        ]);

        $this->reset($this->member, 'Identity checked by a video call')->assertNoContent();

        $this->member->refresh();
        $this->assertNull($this->member->two_factor_secret);
        $this->assertNull($this->member->two_factor_recovery_codes);
        $this->assertNull($this->member->two_factor_confirmed_at);
        $this->assertSame(0, DB::table('passkeys')->where('user_id', $this->member->id)->count());
        $this->assertSame(1, DB::table('passkeys')->where('user_id', $other->id)->count());
        $this->assertSame(KeptSignIn::TWO_STEP_RESET, $kept->refresh()->end_reason);
        $this->assertTrue($othersKept->refresh()->isLive());
        $this->assertDatabaseMissing('sessions', ['id' => 'member-browser']);
        $this->assertDatabaseHas('sessions', ['id' => 'someone-else']);
        $this->assertAuthenticatedAs($this->administrator, 'web');

        $activity = Activity::query()->where('event', SecurityChanged::TWO_STEP_RESET)->sole();
        $this->assertNull($activity->organization_id);
        $this->assertSame($this->member->id, (int) $activity->subject_id);
        $this->assertSame($this->administrator->id, (int) $activity->causer_id);
        $this->assertSame('Identity checked by a video call', $activity->properties['reason']);
        $this->assertSame('admin', $activity->properties['source']);
        $this->assertSame(2, $activity->properties['passkeys_removed']);
        $this->assertStringNotContainsString('two_factor', json_encode($activity->properties) ?: '');
        Notification::assertSentTo($this->member, SecurityChanged::class, fn (SecurityChanged $n): bool => $n->event === SecurityChanged::TWO_STEP_RESET
            && $n->details === ['source' => 'admin']);
    }

    public function test_a_person_without_two_step_or_passkeys_can_still_be_reset(): void
    {
        $this->reset($this->member, 'Asked to be signed out everywhere')->assertNoContent();

        $activity = Activity::query()->where('event', SecurityChanged::TWO_STEP_RESET)->sole();
        $this->assertSame(0, $activity->properties['passkeys_removed']);
        Notification::assertSentTo($this->member, SecurityChanged::class);
    }

    public function test_the_reset_needs_the_permission(): void
    {
        $this->turnOnTwoStep($this->member);
        $manager = $this->platformStaff([PlatformAdministrationPermission::ACCESS, PlatformAdministrationPermission::MANAGE_ORGANIZATIONS]);

        $this->as($manager)->postJson($this->url($this->member), ['reason' => 'Locked out'])->assertForbidden();
        $this->as($this->member)->postJson($this->url($manager), ['reason' => 'Locked out'])->assertForbidden();

        $this->assertTrue($this->member->refresh()->hasEnabledTwoFactorAuthentication());
        $this->assertSame(0, Activity::query()->where('event', SecurityChanged::TWO_STEP_RESET)->count());
        Notification::assertNothingSent();
    }

    public function test_a_reason_of_up_to_500_characters_is_required(): void
    {
        $this->turnOnTwoStep($this->member);

        $this->as($this->administrator)->postJson($this->url($this->member), [])
            ->assertUnprocessable()->assertJsonValidationErrors('reason');
        $this->reset($this->member, '   ')->assertUnprocessable()->assertJsonValidationErrors('reason');
        $this->reset($this->member, str_repeat('a', 501))->assertUnprocessable()->assertJsonValidationErrors('reason');

        $this->assertTrue($this->member->refresh()->hasEnabledTwoFactorAuthentication());
        $this->reset($this->member, str_repeat('a', 500))->assertNoContent();
    }

    public function test_nobody_resets_themselves(): void
    {
        $this->turnOnTwoStep($this->administrator);

        $this->reset($this->administrator, 'Lost my phone')->assertForbidden();

        $this->assertTrue($this->administrator->refresh()->hasEnabledTwoFactorAuthentication());
        Notification::assertNothingSent();
    }

    public function test_only_a_super_administrator_resets_a_super_administrator(): void
    {
        $superAdministrator = User::factory()->create(['is_super_admin' => true]);
        $this->turnOnTwoStep($superAdministrator);

        $this->reset($superAdministrator, 'Locked out')->assertForbidden();
        $this->assertTrue($superAdministrator->refresh()->hasEnabledTwoFactorAuthentication());

        $otherSuperAdministrator = User::factory()->create(['is_super_admin' => true]);
        $this->as($otherSuperAdministrator)->postJson($this->url($superAdministrator), ['reason' => 'Locked out'])->assertNoContent();
        $this->assertFalse($superAdministrator->refresh()->hasEnabledTwoFactorAuthentication());
    }

    public function test_an_unknown_person_is_not_found(): void
    {
        $this->as($this->administrator)->postJson('/api/v1/admin/users/999999/two-step/reset', ['reason' => 'Locked out'])->assertNotFound();
        $this->as($this->administrator)->postJson('/api/v1/admin/users/not-a-number/two-step/reset', ['reason' => 'Locked out'])->assertNotFound();
    }

    public function test_the_users_list_shows_two_step_and_passkeys(): void
    {
        $this->turnOnTwoStep($this->member);
        $this->givePasskeys($this->member, 2);

        $this->as($this->administrator)->getJson('/api/v1/admin/users?search=member@example.test')->assertOk()
            ->assertJsonPath('data.0.email', 'member@example.test')
            ->assertJsonPath('data.0.two_step_enabled', true)
            ->assertJsonPath('data.0.passkey_count', 2);
        $this->as($this->administrator)->getJson('/api/v1/admin/users?search=platform-staff@example.test')->assertOk()
            ->assertJsonPath('data.0.two_step_enabled', false)
            ->assertJsonPath('data.0.passkey_count', 0);
    }

    public function test_the_capability_follows_the_permission(): void
    {
        $manager = $this->platformStaff([PlatformAdministrationPermission::ACCESS, PlatformAdministrationPermission::MANAGE_ORGANIZATIONS]);
        $superAdministrator = User::factory()->create(['is_super_admin' => true]);

        $this->as($this->administrator)->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.capabilities.reset_two_step', true);
        $this->as($manager)->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.capabilities.reset_two_step', false);
        $this->as($superAdministrator)->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.capabilities.reset_two_step', true);
        $this->as($this->member)->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.capabilities.reset_two_step', false);
    }

    public function test_the_seeding_migration_grants_the_permission_to_roles_that_manage_organizations(): void
    {
        $manager = $this->platformStaff([PlatformAdministrationPermission::ACCESS, PlatformAdministrationPermission::MANAGE_ORGANIZATIONS]);
        $retention = $this->platformStaff([PlatformAdministrationPermission::ACCESS, PlatformAdministrationPermission::MANAGE_RETENTION]);
        Permission::query()->where('name', PlatformAdministrationPermission::RESET_TWO_STEP->value)->delete();

        $migration = require database_path('migrations/2026_11_23_000600_seed_reset_two_step_permission.php');
        $migration->up();
        $migration->up();

        $holders = PlatformRole::query()
            ->whereHas('permissions', fn ($query) => $query->where('name', PlatformAdministrationPermission::RESET_TWO_STEP->value))
            ->whereHas('users')
            ->with('users')->get()->flatMap->users->pluck('id')->sort()->values()->all();
        $this->assertEqualsCanonicalizing([$this->administrator->id, $manager->id], $holders);
        $this->assertNotContains($retention->id, $holders);
        $this->assertSame(1, Permission::query()->where('name', PlatformAdministrationPermission::RESET_TWO_STEP->value)->count());
    }

    private function reset(User $person, string $reason): TestResponse
    {
        return $this->as($this->administrator)->postJson($this->url($person), ['reason' => $reason]);
    }

    private function url(User $person): string
    {
        return '/api/v1/admin/users/'.$person->id.'/two-step/reset';
    }

    private function as(User $user): static
    {
        // Sanctum's guard keeps the first person it resolved; a test that switches people forgets it.
        $this->app['auth']->forgetGuards();

        return $this->withHeader('Origin', 'http://localhost')->actingAs($user, 'web');
    }
}
