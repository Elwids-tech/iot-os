<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;

/**
 * Confirms the signed-in person's password before a security change (spec 034, research
 * R8). Routes behind `password.confirm` answer `423` until this has been done in the last
 * `auth.password_timeout` seconds.
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
}
