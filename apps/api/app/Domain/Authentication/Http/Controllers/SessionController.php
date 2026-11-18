<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Http\Controllers;

use App\Domain\Authentication\Http\Requests\LoginRequest;
use App\Domain\Authentication\Http\Resources\AuthenticatedUserResource;
use App\Domain\Authentication\Models\KeptSignIn;
use App\Domain\Authentication\Services\CompleteSignIn;
use App\Domain\Authentication\Services\KeptSignInCookie;
use App\Domain\Notifications\Models\PushDevice;
use App\Domain\Shared\Models\User;
use App\Domain\SignUp\Services\SignUps;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cookie;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class SessionController
{
    public function __construct(
        private readonly KeptSignInCookie $kept,
        private readonly CompleteSignIn $complete,
        private readonly SignUps $signUps,
    ) {}

    /**
     * The password step (spec 034). For a person with two-step on, a right password only
     * starts a pending sign-in in the session and answers `202`; the session starts at
     * `POST auth/two-step`. Everyone else is signed in here, as before.
     */
    public function store(LoginRequest $request): AuthenticatedUserResource|JsonResponse
    {
        $credentials = $request->safe()->only(['email', 'password']);
        $pending = null;

        // The guard's timebox still covers the two-step case, so response timing does not
        // tell who has two-step on. Its callback declines the login for those people.
        $signedIn = Auth::guard('web')->attemptWhen($credentials, static function (User $user) use (&$pending): bool {
            // A required person whose only second step is a passkey finishes with it: the
            // password alone never starts their session (FR-022).
            if ($user->hasEnabledTwoFactorAuthentication() || ($user->twoStepSatisfied() && $user->twoStepRequired())) {
                $pending = $user;

                return false;
            }

            return true;
        });

        if ($pending instanceof User) {
            return TwoStepChallengeController::begin($request, $pending, $request->boolean('remember'));
        }

        if (! $signedIn) {
            // A sign-up nobody confirmed yet has no account; with its own password the
            // browser takes it over so the page can send the link again (spec 035).
            if (! User::query()->where('email', Str::lower(trim((string) $credentials['email'])))->exists()
                && $this->signUps->claimUnconfirmed((string) $credentials['email'], (string) $credentials['password'], $request)) {
                return response()->json([
                    'code' => 'sign_up_unconfirmed',
                    'message' => 'Confirm your email first. We can send the link again.',
                ], 403);
            }

            throw ValidationException::withMessages([
                'email' => __('auth.failed'),
            ]);
        }

        /** @var User $user */
        $user = Auth::guard('web')->user();

        return AuthenticatedUserResource::make(
            ($this->complete)($user, $request->boolean('remember'), $request)->load('organizations'),
        );
    }

    public function show(Request $request): AuthenticatedUserResource
    {
        /** @var User $user */
        $user = $request->user();

        return AuthenticatedUserResource::make(
            $user->loadMissing('organizations'),
        );
    }

    public function destroy(Request $request): JsonResponse
    {
        // Ends only this browser's kept sign-in; other devices stay signed in.
        $keptId = $request->session()->get(KeptSignInCookie::SESSION_KEY);
        if ($keptId !== null) {
            KeptSignIn::query()->find($keptId)?->end(KeptSignIn::SIGNED_OUT);
        }
        if ($this->kept->present($request)) {
            $this->kept->record($request)?->end(KeptSignIn::SIGNED_OUT);
        }
        if ($keptId !== null || $this->kept->present($request)) {
            Cookie::queue($this->kept->forget());
        }
        // This browser stops getting pushes (spec 033, FR-028); the person's other devices keep them.
        $sessionId = $request->session()->getId();
        PushDevice::query()->where('user_id', $request->user()?->getKey())->get()
            ->filter(fn (PushDevice $device): bool => $device->session_id === $sessionId || ($keptId !== null && $device->kept_sign_in_id === (int) $keptId))
            ->each->delete();

        Auth::guard('web')->logout();
        Auth::guard('sanctum')->forgetUser();

        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->json([
            'message' => 'Logged out.',
        ]);
    }
}
