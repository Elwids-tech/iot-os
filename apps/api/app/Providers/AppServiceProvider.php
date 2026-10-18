<?php

namespace App\Providers;

use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Authorization\Services\PlatformAuthorization;
use App\Domain\DeviceProfiles\Services\PublishedParameters;
use App\Domain\DeviceProfiles\Services\UnitCatalogue;
use App\Domain\Shared\Models\User;
use App\Support\Operations;
use Illuminate\Auth\Events\Login;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // Memoizes published artifacts for one request or queued job.
        $this->app->scoped(PublishedParameters::class);
        $this->app->singleton(UnitCatalogue::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Sanctum's session middleware runs before a guest login, so seed the
        // password fingerprint at login rather than waiting for a later request.
        Event::listen(Login::class, static function (Login $event): void {
            if ($event->guard === 'web' && request()->hasSession()) {
                request()->session()->put('password_hash_web', Auth::guard('web')->hashPasswordForCookie($event->user->getAuthPassword()));
            }
        });

        RateLimiter::for('password-recovery', static function (Request $request): array {
            $email = $request->input('email');

            return [
                Limit::perMinute(10)->by('recovery-ip:'.$request->ip()),
                Limit::perHour(5)->by('recovery-email:'.hash('sha256', is_string($email) ? Str::lower(trim($email)) : 'invalid')),
            ];
        });
        // Credential guessing: a few tries per account from one address, and a wider cap per
        // address. There is deliberately no per-account limit across addresses, which would
        // let anyone lock a real user out.
        RateLimiter::for('login', static function (Request $request): array {
            $email = $request->input('email');
            $tooMany = static fn (Request $request, array $headers) => response()->json([
                'message' => 'Too many sign-in attempts. Try again in '.($headers['Retry-After'] ?? 60).' seconds.',
            ], 429, $headers);

            return [
                Limit::perMinute(5)->by('login-account:'.hash('sha256', (is_string($email) ? Str::lower(trim($email)) : 'invalid').'|'.$request->ip()))->response($tooMany),
                Limit::perMinute(30)->by('login-ip:'.$request->ip())->response($tooMany),
            ];
        });
        RateLimiter::for('password-reset', static fn (Request $request) => Limit::perMinute(10)->by('reset-ip:'.$request->ip()));
        // Invitations send email, so bound how many one person or one organization can trigger.
        RateLimiter::for('organization-invitations', static function (Request $request): array {
            $organization = $request->route('organization');

            return [
                Limit::perMinute(20)->by('invitations-user:'.$request->user()?->getAuthIdentifier()),
                Limit::perDay(200)->by('invitations-organization:'.(is_object($organization) ? $organization->getKey() : (string) $organization)),
            ];
        });

        // Support tickets (spec 015) email the team and the people on a ticket.
        RateLimiter::for('support-tickets', static fn (Request $request) => Limit::perHour(10)->by('support-tickets-user:'.$request->user()?->getAuthIdentifier()));
        RateLimiter::for('support-messages', static fn (Request $request) => Limit::perHour(60)->by('support-messages-user:'.$request->user()?->getAuthIdentifier()));

        Queue::looping(static fn () => Operations::heartbeat());

        Gate::before(static fn (?User $user): ?bool => $user?->is_super_admin ? true : null);

        foreach (PlatformAdministrationPermission::cases() as $permission) {
            Gate::define($permission->value, static function (User $user) use ($permission): bool {
                return app(PlatformAuthorization::class)->allows($user, $permission);
            });
        }
    }
}
