<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Http\Controllers;

use App\Domain\Authentication\Http\Resources\AuthenticatedUserResource;
use App\Domain\Authentication\Services\CompleteSignIn;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Passkeys\Actions\GenerateVerificationOptions;
use Laravel\Passkeys\Actions\VerifyPasskey;
use Laravel\Passkeys\Exceptions\InvalidPasskeyException;
use Laravel\Passkeys\Http\Requests\PasskeyVerificationRequest;
use Laravel\Passkeys\Passkeys;
use Laravel\Passkeys\Support\WebAuthn;

/**
 * Sign in with a passkey alone (spec 034, FR-017). A passkey counts as both steps, so it
 * also finishes a pending password sign-in, which it replaces. The session starts in
 * {@see CompleteSignIn}, like every other sign-in, never through the package's guard
 * login or Laravel's remember token.
 */
final class PasskeySignInController
{
    public const OPTIONS = 'passkey.verification_options';

    public function __construct(private readonly CompleteSignIn $complete) {}

    /**
     * WebAuthn request options with no allowed credentials, so the browser offers every
     * passkey it holds for this site. Kept in the session for the answer.
     */
    public function options(Request $request, GenerateVerificationOptions $generate): JsonResponse
    {
        return self::issue($request, $generate());
    }

    public function store(PasskeyVerificationRequest $request, VerifyPasskey $verify): AuthenticatedUserResource
    {
        // Checks the signature, the challenge and the origin, and records `last_used_at`.
        $passkey = $verify($request->credential(), $request->verificationOptions());

        $user = $passkey->user;
        if (! $user instanceof User || ! Passkeys::allowsLogin($request, $passkey)) {
            throw InvalidPasskeyException::make(__('Unable to sign in with this account.'));
        }

        $request->session()->forget(TwoStepChallengeController::SESSION_KEY);
        ($this->complete)($user, $request->remember(), $request);

        return AuthenticatedUserResource::make($user->load('organizations'));
    }

    /**
     * Keep the options for the answer and send them to the browser.
     */
    public static function issue(Request $request, mixed $options): JsonResponse
    {
        $request->session()->put(self::OPTIONS, WebAuthn::toJson($options));

        return response()->json(['options' => WebAuthn::toBrowserArray($options)]);
    }
}
