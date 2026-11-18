<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\SignUp;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use App\Domain\SignUp\Models\SignUp;
use App\Domain\SignUp\Notifications\SignUpAccountExists;
use App\Domain\SignUp\Notifications\SignUpConfirmation;
use App\Domain\SignUp\Services\SignUps;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Notifications\AnonymousNotifiable;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

/** Submitting the sign-up form (spec 035 US1, FR-001 to FR-009, FR-014, FR-015). */
final class StartSignUpTest extends TestCase
{
    use RefreshDatabase, SignsUp;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSignUp();
    }

    public function test_the_page_learns_whether_sign_up_is_open_and_gets_a_form_token_only_while_it_is(): void
    {
        $this->portal()->getJson('/api/v1/sign-up')->assertOk()
            ->assertJson(['open' => true, 'free_beta' => true, 'password_min' => 12])
            ->assertJsonPath('form_token', fn ($token) => is_string($token) && $token !== '');

        $this->setUpSignUp(open: false);
        $this->portal()->getJson('/api/v1/sign-up')->assertOk()
            ->assertJson(['open' => false, 'form_token' => null]);
    }

    public function test_a_closed_sign_up_refuses_before_checking_anything(): void
    {
        $this->setUpSignUp(open: false);

        $this->portal()->postJson('/api/v1/sign-up', ['email' => 'not an email'])
            ->assertForbidden()->assertJson(['code' => 'sign_up_closed']);
        $this->assertSame(0, SignUp::query()->count());
    }

    public function test_a_submission_stores_a_waiting_sign_up_and_emails_a_link_and_creates_nothing_else(): void
    {
        $users = User::query()->count();

        $this->submit(['email' => ' Jane@Example.com '])->assertStatus(202)
            ->assertExactJson(['state' => 'waiting', 'email' => 'jane@example.com', 'resend_after' => 60]);

        $signUp = SignUp::query()->sole();
        $this->assertSame('waiting', $signUp->state);
        $this->assertSame('jane@example.com', $signUp->email);
        $this->assertSame('Acme Water', $signUp->organization_name);
        $this->assertTrue(Hash::check(self::PASSWORD, (string) $signUp->password));
        $this->assertSame(64, strlen((string) $signUp->token_hash));
        $this->assertEqualsWithDelta(now()->addHours(24)->getTimestamp(), $signUp->token_expires_at?->getTimestamp(), 5);
        $this->assertSame(1, $signUp->sends);
        $this->assertSame($signUp->uuid, session(SignUps::SESSION_KEY));
        $this->assertSame(hash('sha256', $this->linkToken()), $signUp->token_hash);

        // FR-008: no person, organization or billing account until the email is confirmed.
        $this->assertSame($users, User::query()->count());
        $this->assertSame(0, Organization::query()->count());
        $this->assertSame(0, BillingAccount::query()->count());
    }

    public function test_fields_follow_the_rules(): void
    {
        $this->submit([
            'name' => '',
            'email' => 'nope',
            'password' => 'short',
            'password_confirmation' => 'short',
            'organization_name' => 'A',
        ])->assertUnprocessable()->assertJsonValidationErrors(['name', 'email', 'password', 'organization_name']);

        $this->submit(['password_confirmation' => 'something else entirely'])
            ->assertUnprocessable()->assertJsonValidationErrors(['password']);
        $this->submit(['organization_name' => str_repeat('a', 81)])
            ->assertUnprocessable()->assertJsonValidationErrors(['organization_name']);

        $this->assertSame(0, SignUp::query()->count());
    }

    public function test_names_may_not_carry_links_or_markup(): void
    {
        foreach (['<b>Acme</b>', 'Visit https://spam.example', 'www.spam.example'] as $text) {
            $this->submit(['organization_name' => $text, 'name' => $text])
                ->assertUnprocessable()->assertJsonValidationErrors(['organization_name', 'name']);
        }
        $this->assertSame(0, SignUp::query()->count());
    }

    public function test_an_address_with_an_account_gets_the_same_answer_and_an_email_and_nothing_is_stored(): void
    {
        $existing = User::factory()->create(['email' => 'jane@example.com']);

        $this->submit()->assertStatus(202)
            ->assertExactJson(['state' => 'waiting', 'email' => 'jane@example.com', 'resend_after' => 60]);

        Notification::assertSentTo($existing, SignUpAccountExists::class);
        Notification::assertNotSentTo(new AnonymousNotifiable, SignUpConfirmation::class);
        $this->assertSame(0, SignUp::query()->count());
        $this->assertNull(session(SignUps::SESSION_KEY));
    }

    public function test_a_new_submission_for_a_waiting_address_replaces_it_and_only_the_newest_link_works(): void
    {
        $this->submit()->assertStatus(202);
        $first = $this->linkToken();

        $this->travel(2)->minutes();
        $this->anotherBrowser();
        $this->submit(['name' => 'Jane D.', 'organization_name' => 'Acme Water Ltd'])->assertStatus(202);

        $signUp = SignUp::query()->sole();
        $this->assertSame('Jane D.', $signUp->name);
        $this->assertSame('Acme Water Ltd', $signUp->organization_name);
        $this->assertSame(2, $signUp->sends);
        $second = $this->linkToken();
        $this->assertNotSame($first, $second);

        $this->confirm($first)->assertNotFound();
        $this->confirm($second)->assertOk()->assertJsonPath('state', 'completed');
        $this->assertSame('Acme Water Ltd', Organization::query()->sole()->name);
    }

    public function test_resend_sends_a_new_link_at_most_once_a_minute_and_five_times_an_hour(): void
    {
        $this->submit()->assertStatus(202);
        $first = $this->linkToken();

        for ($sent = 0; $sent < 5; $sent++) {
            $this->travel(61)->seconds();
            $this->portal()->postJson('/api/v1/sign-up/resend')->assertStatus(202)->assertJson(['state' => 'waiting', 'resend_after' => 60]);
        }
        $this->travel(61)->seconds();
        $this->portal()->postJson('/api/v1/sign-up/resend')->assertStatus(429);

        $this->confirm($first)->assertNotFound();
        $this->confirm($this->linkToken())->assertOk();
    }

    public function test_resend_waits_a_minute_after_the_last_email(): void
    {
        $this->submit()->assertStatus(202);

        $this->portal()->postJson('/api/v1/sign-up/resend')->assertStatus(429)
            ->assertJsonStructure(['message', 'retry_after']);
        $this->portal()->getJson('/api/v1/sign-up/status')->assertOk()
            ->assertJson(['state' => 'waiting', 'email' => 'jane@example.com'])
            ->assertJsonPath('resend_after', fn (int $seconds) => $seconds > 0 && $seconds <= 60);
    }

    public function test_resend_needs_this_browsers_waiting_sign_up(): void
    {
        $this->portal()->postJson('/api/v1/sign-up/resend')->assertNotFound();
        $this->portal()->getJson('/api/v1/sign-up/status')->assertNotFound();
    }
}
