<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Services;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Shared\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;

/**
 * A super administrator signs in as someone else to see the portal as they do, and
 * leaves to become themself again on the admin page they started from.
 *
 * The admin and the portal share one API session, so impersonation lives in it: the
 * session's user becomes the person, and the session remembers who started it and
 * where to go back to. Leaving signs the super administrator back in. Nothing is
 * stored beyond the session, so it ends when the session does. The person's two-step
 * sign-in is not asked for, and a password the super administrator confirmed earlier
 * does not carry over, so their sign-in security cannot be changed while acting as them.
 */
final class Impersonation
{
    public const SESSION_KEY = 'impersonation';

    /**
     * @return array{impersonator_id: int, return_url: string|null, started_at: string}|null
     */
    public function current(?Request $request = null): ?array
    {
        $request ??= request();
        if (! $request->hasSession()) {
            return null;
        }
        $state = $request->session()->get(self::SESSION_KEY);

        return is_array($state) && is_int($state['impersonator_id'] ?? null) ? $state : null;
    }

    public function active(?Request $request = null): bool
    {
        return $this->current($request) !== null;
    }

    public function impersonator(?Request $request = null): ?User
    {
        $state = $this->current($request);

        return $state === null ? null : User::query()->find($state['impersonator_id']);
    }

    public function start(User $impersonator, User $person, ?string $returnUrl, Request $request): void
    {
        abort_unless($impersonator->is_super_admin, 403);
        if ($this->active($request)) {
            throw ValidationException::withMessages(['user' => 'Leave the current impersonation first.']);
        }
        if ($impersonator->is($person)) {
            throw ValidationException::withMessages(['user' => 'You cannot impersonate yourself.']);
        }
        if ($person->is_super_admin) {
            throw ValidationException::withMessages(['user' => 'Super administrators cannot be impersonated.']);
        }

        $this->signInAs($person);
        $session = $request->session();
        $session->forget('auth.password_confirmed_at');
        $session->put(self::SESSION_KEY, [
            'impersonator_id' => (int) $impersonator->getKey(),
            'return_url' => $this->safeReturnUrl($returnUrl),
            'started_at' => now()->toIso8601String(),
        ]);

        ActivityLog::record('user.impersonation_started', null, $impersonator, null, [
            'user_id' => $person->getKey(),
            'email' => $person->email,
        ]);
    }

    /**
     * Become the super administrator again. Returns where to send them: the admin page
     * they started from, or the admin's home.
     */
    public function leave(Request $request): string
    {
        $state = $this->current($request);
        if ($state === null) {
            throw ValidationException::withMessages(['impersonation' => 'You are not impersonating anyone.']);
        }

        $person = $request->user();
        $impersonator = User::query()->find($state['impersonator_id']);
        $session = $request->session();
        $session->forget([self::SESSION_KEY, 'auth.password_confirmed_at']);

        // Their super administrator access went while they were away: end the session.
        if (! $impersonator instanceof User || ! $impersonator->is_super_admin) {
            Auth::guard('web')->logout();
            Auth::guard('sanctum')->forgetUser();
            $session->invalidate();
            $session->regenerateToken();

            return $this->adminUrl();
        }

        $this->signInAs($impersonator);
        ActivityLog::record('user.impersonation_ended', null, $impersonator, null, [
            'user_id' => $person instanceof User ? $person->getKey() : null,
            'email' => $person instanceof User ? $person->email : null,
        ]);

        return $state['return_url'] ?? $this->adminUrl();
    }

    /**
     * Switch the session's person. Sanctum keeps the request's person from before; it
     * must resolve the new one, or the session's password fingerprint is written for the
     * old person after the response and the next request is signed out.
     */
    private function signInAs(User $user): void
    {
        Auth::guard('web')->login($user);
        Auth::guard('sanctum')->forgetUser();
    }

    /** Only the platform's own apps are places to go back to, never another site. */
    private function safeReturnUrl(?string $url): ?string
    {
        if ($url === null || $url === '') {
            return null;
        }
        $parts = parse_url($url);
        if (! is_array($parts) || ! in_array($parts['scheme'] ?? null, ['http', 'https'], true) || ! isset($parts['host'])) {
            return null;
        }
        $origin = $parts['host'].(isset($parts['port']) ? ':'.$parts['port'] : '');

        return in_array($origin, $this->trustedOrigins(), true) ? $url : null;
    }

    /** @return list<string> */
    private function trustedOrigins(): array
    {
        $admin = parse_url($this->adminUrl());
        $origins = array_map('trim', (array) config('sanctum.stateful', []));
        if (is_array($admin) && isset($admin['host'])) {
            $origins[] = $admin['host'].(isset($admin['port']) ? ':'.$admin['port'] : '');
        }

        return array_values(array_filter($origins, fn (string $origin): bool => $origin !== ''));
    }

    private function adminUrl(): string
    {
        return (string) config('app.admin_url');
    }
}
