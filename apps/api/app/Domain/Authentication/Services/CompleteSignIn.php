<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Services;

use App\Domain\Authentication\Models\KeptSignIn;
use App\Domain\Branding\Services\PortalAccess;
use App\Domain\Shared\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cookie;

/**
 * The one place a person's session starts (spec 034, ADR-048): after the password alone,
 * after the password and a code, and after a passkey. It starts the `web` session and
 * issues the per-device kept sign-in (spec 033, ADR-047), never Laravel's remember token.
 * It is also where a portal address turns away a person it is not for (spec 036).
 */
final class CompleteSignIn
{
    public function __construct(
        private readonly KeptSignInCookie $kept,
        private readonly PortalAccess $access,
    ) {}

    public function __invoke(User $user, bool $remember, Request $request): User
    {
        // On a billing account's address only its people get in (spec 036, FR-020). The
        // refusal comes here, after the password and any second step, so it tells nobody
        // who has an account (FR-022).
        if (! $this->access->admits($user, $request)) {
            if (Auth::guard('web')->id() === $user->getKey()) {
                Auth::guard('web')->logout();
            }
            $this->access->refuse();
        }

        // The password step has already logged the person in when no second step was due.
        if (Auth::guard('web')->id() !== $user->getKey()) {
            Auth::guard('web')->login($user);
        }

        // A new sign-in replaces whatever this browser kept before.
        $this->kept->record($request)?->end(KeptSignIn::SIGNED_OUT);
        $request->session()->forget(KeptSignInCookie::SESSION_KEY);
        $request->session()->regenerate();

        if ($remember) {
            [$record, $secret] = KeptSignIn::issue($user, $this->kept->label($request->userAgent()));
            $request->session()->put(KeptSignInCookie::SESSION_KEY, $record->getKey());
            Cookie::queue($this->kept->make($record, $secret));
        } elseif ($this->kept->present($request)) {
            Cookie::queue($this->kept->forget());
        }

        return $user;
    }
}
