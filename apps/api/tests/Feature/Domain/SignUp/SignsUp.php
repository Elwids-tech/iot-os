<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\SignUp;

use App\Domain\SignUp\Models\SignUp;
use App\Domain\SignUp\Notifications\SignUpConfirmation;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Notifications\AnonymousNotifiable;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cookie;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Testing\TestResponse;

/** Shared steps for the sign-up tests (spec 035). Requests come from the portal's origin. */
trait SignsUp
{
    protected const PASSWORD = 'a long enough password';

    protected function setUpSignUp(bool $open = true): void
    {
        $this->withoutMiddleware(ValidateCsrfToken::class);
        Notification::fake();
        DB::table('sign_up_settings')->where('id', 1)->update(['open' => $open]);
    }

    /** @return array<string, string> */
    protected function form(array $overrides = []): array
    {
        $token = $this->portal()->getJson('/api/v1/sign-up')->assertOk()->json('form_token');
        $this->travel(5)->seconds();

        return [
            'name' => 'Jane Doe',
            'email' => 'jane@example.com',
            'password' => self::PASSWORD,
            'password_confirmation' => self::PASSWORD,
            'organization_name' => 'Acme Water',
            'form_token' => (string) $token,
            'website' => '',
            ...$overrides,
        ];
    }

    protected function submit(array $overrides = []): TestResponse
    {
        return $this->portal()->postJson('/api/v1/sign-up', $this->form($overrides));
    }

    protected function portal(): static
    {
        return $this->withHeader('Origin', 'http://localhost');
    }

    /** The token from the latest confirmation email to the address. */
    protected function linkToken(string $email = 'jane@example.com'): string
    {
        $token = null;
        Notification::assertSentTo(
            new AnonymousNotifiable,
            SignUpConfirmation::class,
            function (SignUpConfirmation $notification, array $channels, AnonymousNotifiable $notifiable) use ($email, &$token): bool {
                if (! array_key_exists($email, (array) $notifiable->routes['mail'])) {
                    return false;
                }
                $url = $notification->toMail($notifiable)->actionUrl;
                parse_str((string) parse_url($url, PHP_URL_FRAGMENT), $query);
                $token = (string) $query['token'];

                return true;
            },
        );

        return (string) $token;
    }

    protected function confirm(string $token): TestResponse
    {
        return $this->portal()->postJson('/api/v1/sign-up/confirm', ['token' => $token]);
    }

    /** Another browser: no session, no cookies, nobody signed in. */
    protected function anotherBrowser(): void
    {
        Auth::forgetGuards();
        $this->flushSession();
        Cookie::flushQueuedCookies();
        $this->defaultCookies = [];
    }

    protected function signUpRow(): SignUp
    {
        return SignUp::query()->where('email', 'jane@example.com')->latest('id')->firstOrFail();
    }
}
