<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\SignUp;

use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use App\Domain\SignUp\Models\SignUp;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The waiting page and who it signs in (spec 035 FR-011, FR-018, research R3), the
 * sign-in hint for an unconfirmed sign-up, and that a sign-up joins nothing it did not
 * create (constitution III).
 */
final class SignUpStatusTest extends TestCase
{
    use RefreshDatabase, SignsUp;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSignUp();
    }

    public function test_the_waiting_browser_is_signed_in_once_after_the_link_is_opened_elsewhere(): void
    {
        $this->submit()->assertStatus(202);
        $token = $this->linkToken();
        $waiting = $this->app['session.store']->all();

        $this->portal()->getJson('/api/v1/sign-up/status')->assertOk()
            ->assertJson(['state' => 'waiting', 'email' => 'jane@example.com']);

        // The phone opens the link: confirmed, not signed in.
        $this->anotherBrowser();
        $this->confirm($token)->assertOk()->assertJsonPath('signed_in', false);
        $this->assertGuest('web');

        // The computer polls and is signed in.
        $this->anotherBrowser();
        $this->withSession($waiting);
        $organization = Organization::query()->sole();
        $this->portal()->getJson('/api/v1/sign-up/status')->assertOk()->assertExactJson([
            'state' => 'completed',
            'signed_in' => true,
            'organization_uuid' => $organization->uuid,
            'email' => 'jane@example.com',
        ]);
        $this->assertAuthenticatedAs(User::query()->where('email', 'jane@example.com')->sole(), 'web');

        // Never twice, even with the same session data copied elsewhere.
        $this->anotherBrowser();
        $this->withSession($waiting);
        $this->portal()->getJson('/api/v1/sign-up/status')->assertOk()->assertJson(['state' => 'completed', 'signed_in' => false]);
        $this->assertGuest('web');
    }

    public function test_the_waiting_browser_is_not_signed_in_after_an_hour(): void
    {
        $this->submit()->assertStatus(202);
        $token = $this->linkToken();
        $waiting = $this->app['session.store']->all();

        $this->anotherBrowser();
        $this->confirm($token)->assertOk();
        $this->travel(61)->minutes();

        $this->anotherBrowser();
        $this->withSession($waiting);
        $this->portal()->getJson('/api/v1/sign-up/status')->assertOk()->assertJson(['state' => 'completed', 'signed_in' => false]);
        $this->assertGuest('web');
    }

    public function test_a_browser_that_did_not_submit_learns_nothing_and_is_never_signed_in(): void
    {
        $this->submit()->assertStatus(202);
        $token = $this->linkToken();

        $this->anotherBrowser();
        $this->portal()->getJson('/api/v1/sign-up/status')->assertNotFound();
        $this->withSession(['sign_up.pending' => 'not-a-uuid'])->getJson('/api/v1/sign-up/status')->assertNotFound();

        $this->confirm($token)->assertOk()->assertJsonPath('signed_in', false);
        $this->portal()->getJson('/api/v1/sign-up/status')->assertNotFound();
        $this->assertGuest('web');
    }

    public function test_a_person_with_a_second_step_is_never_signed_in_by_the_sign_up(): void
    {
        $this->submit()->assertStatus(202);
        $token = $this->linkToken();
        $waiting = $this->app['session.store']->all();

        $this->anotherBrowser();
        $this->confirm($token)->assertOk();
        User::query()->where('email', 'jane@example.com')->sole()->forceFill([
            'two_factor_secret' => encrypt('secret'),
            'two_factor_confirmed_at' => now(),
        ])->save();

        $this->anotherBrowser();
        $this->withSession($waiting);
        $this->portal()->getJson('/api/v1/sign-up/status')->assertOk()->assertJson(['state' => 'completed', 'signed_in' => false]);
        $this->assertGuest('web');
    }

    public function test_signing_in_before_confirming_says_so_and_lets_the_browser_resend(): void
    {
        $this->submit()->assertStatus(202);
        $this->anotherBrowser();

        $this->portal()->postJson('/api/v1/auth/login', ['email' => 'jane@example.com', 'password' => 'not the password'])
            ->assertUnprocessable()->assertJsonValidationErrors('email');
        $this->portal()->getJson('/api/v1/sign-up/status')->assertNotFound();

        $this->portal()->postJson('/api/v1/auth/login', ['email' => 'Jane@Example.com', 'password' => self::PASSWORD])
            ->assertForbidden()->assertJson(['code' => 'sign_up_unconfirmed']);
        $this->assertGuest('web');

        $this->travel(61)->seconds();
        $this->portal()->postJson('/api/v1/sign-up/resend')->assertStatus(202);
    }

    public function test_a_completed_sign_up_signs_in_like_anyone(): void
    {
        $this->submit()->assertStatus(202);
        $token = $this->linkToken();
        $this->anotherBrowser();
        $this->confirm($token)->assertOk();

        $this->portal()->postJson('/api/v1/auth/login', ['email' => 'jane@example.com', 'password' => self::PASSWORD])
            ->assertOk()->assertJsonPath('data.email', 'jane@example.com');
    }

    public function test_a_sign_up_joins_nothing_it_did_not_create(): void
    {
        $other = Organization::factory()->create(['name' => 'Acme Water', 'slug' => 'acme-water']);
        $member = User::factory()->create();
        $member->organizations()->attach($other->getKey());

        $this->submit()->assertStatus(202);
        $this->confirm($this->linkToken())->assertOk()->assertJsonPath('signed_in', true);

        $user = User::query()->where('email', 'jane@example.com')->sole();
        $this->assertSame([SignUp::query()->sole()->organization_id], $user->organizations()->pluck('organizations.id')->all());
        $this->assertSame(1, $other->users()->count());

        $this->portal()->getJson('/api/v1/me')->assertOk()->assertJsonCount(1, 'data.organizations')
            ->assertJsonMissing(['uuid' => $other->uuid]);
        $this->portal()->getJson('/api/v1/billing-accounts')->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', 'Acme Water')
            ->assertJsonMissing(['uuid' => $other->billingAccount?->uuid]);
        $this->portal()->getJson("/api/v1/organizations/{$other->uuid}/context")->assertForbidden();
    }
}
