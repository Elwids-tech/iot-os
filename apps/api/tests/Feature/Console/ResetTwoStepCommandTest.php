<?php

declare(strict_types=1);

namespace Tests\Feature\Console;

use App\Domain\Audit\Models\Activity;
use App\Domain\Authentication\Models\KeptSignIn;
use App\Domain\Authentication\Notifications\SecurityChanged;
use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Tests\Support\TwoStepFixtures;
use Tests\Support\TwoStepResetFixtures;
use Tests\TestCase;

/** The server operator resets a locked-out person's two-step sign-in (spec 034, US4, FR-026). */
final class ResetTwoStepCommandTest extends TestCase
{
    use RefreshDatabase, TwoStepFixtures, TwoStepResetFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
    }

    public function test_the_command_performs_the_reset_with_no_causer(): void
    {
        $person = User::factory()->create(['email' => 'member@example.test', 'is_super_admin' => true]);
        $this->turnOnTwoStep($person);
        $this->givePasskeys($person, 1);
        [$kept] = KeptSignIn::issue($person, 'Chrome on Android');

        $this->artisan('auth:reset-two-step', ['email' => 'Member@Example.test', '--reason' => 'Identity checked in person'])
            ->expectsOutputToContain('Two-step sign-in reset for member@example.test')
            ->assertSuccessful();

        $person->refresh();
        $this->assertFalse($person->hasEnabledTwoFactorAuthentication());
        $this->assertNull($person->two_factor_secret);
        $this->assertSame(0, DB::table('passkeys')->where('user_id', $person->id)->count());
        $this->assertSame(KeptSignIn::TWO_STEP_RESET, $kept->refresh()->end_reason);

        $activity = Activity::query()->where('event', SecurityChanged::TWO_STEP_RESET)->sole();
        $this->assertNull($activity->organization_id);
        $this->assertNull($activity->causer_id);
        $this->assertSame($person->id, (int) $activity->subject_id);
        $this->assertSame('Identity checked in person', $activity->properties['reason']);
        $this->assertSame('console', $activity->properties['source']);
        $this->assertSame(1, $activity->properties['passkeys_removed']);
        Notification::assertSentTo($person, SecurityChanged::class, fn (SecurityChanged $n): bool => $n->event === SecurityChanged::TWO_STEP_RESET
            && $n->details === ['source' => 'console']);
    }

    public function test_an_unknown_email_fails(): void
    {
        $this->artisan('auth:reset-two-step', ['email' => 'nobody@example.test', '--reason' => 'Locked out'])
            ->expectsOutputToContain('No person has the email address nobody@example.test')
            ->assertFailed();

        $this->assertSame(0, Activity::query()->where('event', SecurityChanged::TWO_STEP_RESET)->count());
    }

    public function test_a_reason_is_required(): void
    {
        $person = User::factory()->create(['email' => 'member@example.test']);
        $this->turnOnTwoStep($person);

        $this->artisan('auth:reset-two-step', ['email' => 'member@example.test'])->assertExitCode(2);
        $this->artisan('auth:reset-two-step', ['email' => 'member@example.test', '--reason' => '  '])->assertExitCode(2);
        $this->artisan('auth:reset-two-step', ['email' => 'member@example.test', '--reason' => str_repeat('a', 501)])->assertExitCode(2);

        $this->assertTrue($person->refresh()->hasEnabledTwoFactorAuthentication());
        Notification::assertNothingSent();
    }
}
