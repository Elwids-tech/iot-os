<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\SignUp;

use App\Domain\SignUp\Events\SignUpsPaused;
use App\Domain\SignUp\Models\SignUp;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

/** Bots and floods (spec 035 FR-040 to FR-042, research R7). */
final class AbuseProtectionTest extends TestCase
{
    use RefreshDatabase, SignsUp;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSignUp();
    }

    public function test_the_hidden_field_and_the_form_token_hold_back_bots_and_the_refusals_are_listed_without_a_password(): void
    {
        $this->submit(['website' => 'https://spam.example'])->assertUnprocessable()->assertJsonValidationErrors('form');
        $this->submit(['form_token' => null])->assertUnprocessable()->assertJsonValidationErrors('form');
        $this->submit(['form_token' => 'forged'])->assertUnprocessable()->assertJsonValidationErrors('form');

        // Sent the moment the form appears.
        $tooFast = $this->portal()->getJson('/api/v1/sign-up')->json('form_token');
        $this->portal()->postJson('/api/v1/sign-up', [
            'name' => 'Bot', 'email' => 'quick@example.com', 'password' => self::PASSWORD, 'password_confirmation' => self::PASSWORD,
            'organization_name' => 'Bots', 'form_token' => $tooFast,
        ])->assertUnprocessable()->assertJsonValidationErrors('form');

        $old = $this->portal()->getJson('/api/v1/sign-up')->json('form_token');
        $this->travel(2)->hours();
        $this->travel(1)->minutes();
        $this->portal()->postJson('/api/v1/sign-up', [
            'name' => 'Late', 'email' => 'late@example.com', 'password' => self::PASSWORD, 'password_confirmation' => self::PASSWORD,
            'organization_name' => 'Late', 'form_token' => $old,
        ])->assertUnprocessable()->assertJsonValidationErrors('form');

        $refused = SignUp::query()->where('state', 'refused')->orderBy('id')->get();
        $this->assertSame(['honeypot', 'form_expired', 'form_expired', 'too_fast', 'form_expired'], $refused->pluck('refusal_reason')->all());
        $this->assertTrue($refused->every(fn (SignUp $signUp) => $signUp->password === null && $signUp->token_hash === null));
    }

    public function test_one_address_gets_five_attempts_an_hour_and_one_email_three(): void
    {
        for ($attempt = 1; $attempt <= 3; $attempt++) {
            $this->submit()->assertStatus(202);
        }
        $this->submit()->assertStatus(429)->assertJsonStructure(['message', 'retry_after']);

        // A refused attempt is not counted, so the address has used three of its five.
        $this->submit(['email' => 'other@example.com'])->assertStatus(202);
        $this->submit(['email' => 'third@example.com'])->assertStatus(202);
        $this->submit(['email' => 'fourth@example.com'])->assertStatus(429);

        $this->travel(61)->minutes();
        $this->submit(['email' => 'fourth@example.com'])->assertStatus(202);
    }

    public function test_the_daily_ceiling_pauses_sign_up_and_tells_staff_once(): void
    {
        Event::fake([SignUpsPaused::class]);
        DB::table('sign_up_settings')->update(['daily_limit' => 2]);
        SignUp::query()->insert([
            ['uuid' => fake()->uuid(), 'name' => 'A', 'email' => 'a@example.com', 'organization_name' => 'A', 'state' => 'waiting', 'created_at' => now(), 'updated_at' => now()],
            ['uuid' => fake()->uuid(), 'name' => 'B', 'email' => 'b@example.com', 'organization_name' => 'B', 'state' => 'completed', 'created_at' => now(), 'updated_at' => now()],
        ]);

        $this->submit()->assertStatus(503)->assertJson(['code' => 'sign_up_paused'])->assertJsonStructure(['retry_after']);
        $this->submit(['email' => 'second@example.com'])->assertStatus(503);

        Event::assertDispatchedTimes(SignUpsPaused::class, 1);
        $this->assertSame(['paused', 'paused'], SignUp::query()->where('state', 'refused')->pluck('refusal_reason')->all());

        $this->travelTo(now()->addDay()->startOfDay()->addMinute());
        $this->submit(['email' => 'third@example.com'])->assertStatus(202);
    }
}
