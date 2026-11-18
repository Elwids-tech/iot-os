<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Http\Controllers;

use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;
use Laravel\Passkeys\Actions\GenerateVerificationOptions;
use Laravel\Passkeys\Actions\VerifyPasskey;
use Laravel\Passkeys\Http\Requests\PasskeyVerificationRequest;

/**
 * Confirms the signed-in person's password, or one of their passkeys, before a security
 * change (spec 034, research R8). Routes behind `password.confirm` answer `423` until
 * this has been done in the last `auth.password_timeout` seconds.
 */
final class ConfirmationController
{
    public function password(Request $request): Response
    {
        $validated = $request->validate(['password' => ['required', 'string']]);

        if (! Auth::guard('web')->validate(['email' => $request->user()?->email, 'password' => $validated['password']])) {
            throw ValidationException::withMessages(['password' => __('auth.password')]);
        }

        $request->session()->passwordConfirmed();

        return response()->noContent();
    }

    /**
     * WebAuthn request options limited to the signed-in person's own passkeys.
     */
    public function passkeyOptions(Request $request, GenerateVerificationOptions $generate): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();

        return PasskeySignInController::issue($request, $generate($user));
    }

    /**
     * A passkey of the signed-in person confirms them, like their password. It answers
     * `200` with a JSON body because the browser client reads one.
     */
    public function passkey(PasskeyVerificationRequest $request, VerifyPasskey $verify): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        $verify($request->credential(), $request->verificationOptions(), $user);

        $request->session()->passwordConfirmed();

        return response()->json(['confirmed' => true]);
    }
}
