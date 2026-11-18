<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Authentication;

use App\Domain\Audit\Models\Activity;
use App\Domain\Authentication\Models\KeptSignIn;
use App\Domain\Authentication\Notifications\SecurityChanged;
use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Testing\TestResponse;
use Laravel\Passkeys\Passkey;
use Tests\Support\PasskeyFixtures;
use Tests\Support\TwoStepFixtures;
use Tests\Support\VirtualAuthenticator;
use Tests\TestCase;

/** A person's own passkeys (spec 034, US2, FR-016, FR-018, FR-019, FR-027). */
final class PasskeyManagementTest extends TestCase
{
    use PasskeyFixtures, RefreshDatabase, TwoStepFixtures;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ValidateCsrfToken::class);
        Notification::fake();
        $this->user = User::factory()->create(['password' => 'password', 'email' => 'operator@example.test']);
    }

    public function test_adding_listing_and_removing_a_passkey(): void
    {
        $this->confirmPassword();
        $authenticator = new VirtualAuthenticator;

        $added = $this->add($authenticator, 'MacBook Touch ID')->assertCreated()
            ->assertJsonPath('data.name', 'MacBook Touch ID')
            ->assertJsonPath('data.last_used_at', null)
            ->json('data');

        $security = $this->as()->getJson('/api/v1/me/security')->assertOk()
            ->assertJsonPath('data.passkeys.available', true)
            ->assertJsonPath('data.passkeys.unavailable_reason', null)
            ->assertJsonPath('data.passkeys.items.0.id', $added['id'])
            ->assertJsonPath('data.passkeys.items.0.name', 'MacBook Touch ID')
            ->assertJsonPath('data.two_step.satisfied', true);
        $this->assertNotNull($security->json('data.passkeys.items.0.created_at'));
        $this->assertStringNotContainsString($authenticator->credentialId(), (string) $security->getContent());
        $this->assertArrayNotHasKey('credential', $security->json('data.passkeys.items.0'));

        $this->as()->deleteJson("/api/v1/me/passkeys/{$added['id']}")->assertNoContent();

        $this->assertSame(0, Passkey::query()->count());
        $this->as()->getJson('/api/v1/me/security')->assertJsonPath('data.passkeys.items', [])
            ->assertJsonPath('data.two_step.satisfied', false);
    }

    public function test_the_name_is_one_to_sixty_characters(): void
    {
        $this->confirmPassword();

        $this->add(new VirtualAuthenticator, '')->assertUnprocessable()->assertJsonValidationErrors('name');
        $this->add(new VirtualAuthenticator, str_repeat('a', 61))->assertUnprocessable()
            ->assertJsonPath('errors.name.0', 'Give the passkey a name of 1 to 60 characters.');
        $this->add(new VirtualAuthenticator, str_repeat('a', 60))->assertCreated();
    }

    public function test_changes_need_a_recent_confirmation(): void
    {
        [, $passkey] = $this->givePasskey($this->user);

        $this->as()->getJson('/api/v1/me/passkeys/options')->assertStatus(423);
        $this->as()->postJson('/api/v1/me/passkeys', ['name' => 'Phone', 'credential' => []])->assertStatus(423);
        $this->as()->deleteJson("/api/v1/me/passkeys/{$passkey->id}")->assertStatus(423);
        $this->assertSame(1, Passkey::query()->count());
    }

    public function test_a_passkey_confirms_the_person_instead_of_the_password(): void
    {
        [$authenticator, $passkey] = $this->givePasskey($this->user);
        $this->as()->getJson('/api/v1/me/passkeys/options')->assertStatus(423);

        $options = $this->as()->getJson('/api/v1/auth/confirm-passkey/options')->assertOk()->json('options');
        // Only the person's own passkeys are offered.
        $this->assertCount(1, $options['allowCredentials']);
        $this->assertSame($authenticator->credentialId(), $options['allowCredentials'][0]['id']);

        $this->as()->postJson('/api/v1/auth/confirm-passkey', ['credential' => $authenticator->assert($options)])
            ->assertOk()->assertExactJson(['confirmed' => true]);

        $this->assertNotNull($passkey->refresh()->last_used_at);
        $this->as()->getJson('/api/v1/me/passkeys/options')->assertOk();
    }

    public function test_another_persons_passkey_does_not_confirm(): void
    {
        $other = User::factory()->create();
        [$theirs] = $this->givePasskey($other);
        $this->givePasskey($this->user);

        $options = $this->as()->getJson('/api/v1/auth/confirm-passkey/options')->assertOk()->json('options');
        $this->as()->postJson('/api/v1/auth/confirm-passkey', ['credential' => $theirs->assert($options)])
            ->assertUnprocessable()->assertJsonValidationErrors('credential');
        $this->as()->getJson('/api/v1/me/passkeys/options')->assertStatus(423);
    }

    public function test_another_persons_passkey_is_not_found(): void
    {
        $other = User::factory()->create();
        [, $theirs] = $this->givePasskey($other);
        $this->confirmPassword();

        $this->as()->deleteJson("/api/v1/me/passkeys/{$theirs->id}")->assertNotFound();
        $this->as()->deleteJson('/api/v1/me/passkeys/999999')->assertNotFound();

        $this->assertTrue(Passkey::query()->whereKey($theirs->id)->exists());
        Notification::assertNothingSent();
    }

    public function test_a_passkey_already_registered_is_refused(): void
    {
        $this->confirmPassword();
        $authenticator = new VirtualAuthenticator;
        $this->add($authenticator, 'Laptop')->assertCreated();

        $options = $this->as()->getJson('/api/v1/me/passkeys/options')->assertOk()->json('options');
        // The browser is told to skip it…
        $this->assertSame($authenticator->credentialId(), $options['excludeCredentials'][0]['id']);
        // …and the API refuses it when it arrives anyway.
        $this->as()->postJson('/api/v1/me/passkeys', ['name' => 'Laptop again', 'credential' => $authenticator->register($options)])
            ->assertUnprocessable()->assertJsonValidationErrors('credential');

        $this->assertSame(1, Passkey::query()->count());
    }

    public function test_someone_elses_passkey_cannot_be_claimed(): void
    {
        $other = User::factory()->create();
        [$theirs] = $this->givePasskey($other);
        $this->confirmPassword();

        $options = $this->as()->getJson('/api/v1/me/passkeys/options')->assertOk()->json('options');
        $this->as()->postJson('/api/v1/me/passkeys', ['name' => 'Laptop', 'credential' => $theirs->register($options)])
            ->assertUnprocessable()->assertJsonValidationErrors('credential');
        $this->assertSame(0, $this->user->passkeys()->count());
    }

    public function test_adding_and_removing_are_recorded_and_emailed_without_ending_other_sign_ins(): void
    {
        config(['session.driver' => 'database']);
        [$otherKept] = KeptSignIn::issue($this->user, 'Chrome on Android');
        DB::table('sessions')->insert(['id' => 'other-browser', 'user_id' => $this->user->id, 'payload' => '', 'last_activity' => time()]);
        $this->confirmPassword();
        $authenticator = new VirtualAuthenticator;

        $id = $this->add($authenticator, 'Office YubiKey')->assertCreated()->json('data.id');
        $this->as()->deleteJson("/api/v1/me/passkeys/{$id}")->assertNoContent();

        foreach ([SecurityChanged::PASSKEY_ADDED, SecurityChanged::PASSKEY_REMOVED] as $event) {
            $activity = Activity::query()->where('event', $event)->sole();
            $this->assertNull($activity->organization_id);
            $this->assertSame($this->user->id, (int) $activity->subject_id);
            $this->assertSame($this->user->id, (int) $activity->causer_id);
            $this->assertSame('Office YubiKey', $activity->properties['name'] ?? null);
            $this->assertStringNotContainsString($authenticator->credentialId(), (string) json_encode($activity->properties));
            Notification::assertSentTo($this->user, SecurityChanged::class, fn (SecurityChanged $n): bool => $n->event === $event && $n->details === ['name' => 'Office YubiKey']);
        }
        $this->assertTrue($otherKept->refresh()->isLive());
        $this->assertDatabaseHas('sessions', ['id' => 'other-browser']);
    }

    public function test_passkeys_cannot_be_used_without_https(): void
    {
        [, $passkey] = $this->givePasskey($this->user);
        config(['passkeys.allowed_origins' => ['http://portal.example.com', 'https://admin.example.com']]);
        $this->confirmPassword();

        $this->as()->getJson('/api/v1/me/security')->assertOk()
            ->assertJsonPath('data.passkeys.available', false)
            ->assertJsonPath('data.passkeys.unavailable_reason', 'not_https')
            // The passkey stays listed, so it can still be removed, but it no longer counts.
            ->assertJsonPath('data.passkeys.items.0.id', $passkey->id)
            ->assertJsonPath('data.two_step.satisfied', false);
        $this->as()->getJson('/api/v1/me/passkeys/options')->assertNotFound();
        $this->as()->getJson('/api/v1/auth/confirm-passkey/options')->assertNotFound();
        $this->as()->deleteJson("/api/v1/me/passkeys/{$passkey->id}")->assertNoContent();
    }

    public function test_passkeys_need_secure_origins_and_a_domain_name(): void
    {
        $reason = fn (): ?string => $this->as()->getJson('/api/v1/me/security')->json('data.passkeys.unavailable_reason');

        $this->assertNull($reason());
        config(['passkeys.allowed_origins' => ['https://app.example.com', 'https://admin.example.com'], 'passkeys.relying_party_id' => 'example.com']);
        $this->assertNull($reason());
        config(['passkeys.allowed_origins' => ['https://app.example.com', 'http://admin.example.com']]);
        $this->assertSame('not_https', $reason());
        // Browsers refuse an IP address as the relying party, even on a secure page.
        config(['passkeys.allowed_origins' => ['http://localhost:5173'], 'passkeys.relying_party_id' => '127.0.0.1']);
        $this->assertSame('not_https', $reason());
        config(['passkeys.allowed_origins' => [], 'passkeys.relying_party_id' => 'localhost']);
        $this->assertSame('not_https', $reason());
    }

    public function test_the_password_step_offers_a_passkey_to_people_with_two_step_on(): void
    {
        $this->turnOnTwoStep($this->user);
        $this->givePasskey($this->user);

        $this->login()->assertStatus(202)->assertJsonPath('methods', ['code', 'recovery_code', 'passkey']);

        config(['passkeys.allowed_origins' => ['http://portal.example.com', 'https://admin.example.com']]);
        $this->login()->assertStatus(202)->assertJsonPath('methods', ['code', 'recovery_code']);
    }

    public function test_a_passkey_alone_does_not_add_a_step_to_the_password(): void
    {
        $this->givePasskey($this->user);

        $this->login()->assertOk();
        $this->assertAuthenticatedAs($this->user, 'web');
    }

    private function add(VirtualAuthenticator $authenticator, string $name): TestResponse
    {
        $options = $this->as()->getJson('/api/v1/me/passkeys/options')->assertOk()->json('options');

        return $this->as()->postJson('/api/v1/me/passkeys', ['name' => $name, 'credential' => $authenticator->register($options)]);
    }

    private function login(): TestResponse
    {
        Auth::forgetGuards();
        $this->flushSession();

        return $this->withHeader('Origin', 'http://localhost')
            ->postJson('/api/v1/auth/login', ['email' => $this->user->email, 'password' => 'password']);
    }

    private function confirmPassword(): void
    {
        $this->as()->postJson('/api/v1/auth/confirm-password', ['password' => 'password'])->assertNoContent();
    }

    private function as(): static
    {
        return $this->withHeader('Origin', 'http://localhost')->actingAs($this->user, 'web');
    }
}
