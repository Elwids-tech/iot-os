<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Http\Controllers;

use App\Domain\Authentication\Http\Requests\ForgotPasswordRequest;
use App\Domain\Authentication\Http\Requests\ResetPasswordRequest;
use App\Domain\Authentication\Notifications\PasswordResetNotification;
use App\Domain\Shared\Models\User;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class PasswordRecoveryController
{
    public function request(ForgotPasswordRequest $request): JsonResponse
    {
        Password::broker()->sendResetLink($request->validated(), static function (User $user, string $token): void {
            $user->notify(new PasswordResetNotification($token));
        });

        return response()->json(['message' => 'If an account exists for that email address, we will send a password reset link.']);
    }

    public function reset(ResetPasswordRequest $request): JsonResponse
    {
        $status = DB::transaction(function () use ($request): string {
            // Serialize consumption of the same token, including concurrent requests.
            DB::table(config('auth.passwords.users.table'))
                ->where('email', $request->validated('email'))->lockForUpdate()->first();

            return Password::broker()->reset($request->validated(), static function (User $user, string $password) use ($request): void {
                $user->forceFill(['password' => Hash::make($password), 'remember_token' => Str::random(60)])->save();
                $user->tokens()->delete();
                if (config('session.driver') === 'database') {
                    DB::connection(config('session.connection'))->table(config('session.table', 'sessions'))
                        ->where('user_id', $user->getKey())->delete();
                }
                if (Auth::guard('web')->id() === $user->getKey()) {
                    Auth::guard('web')->logout();
                    if ($request->hasSession()) {
                        $request->session()->invalidate();
                        $request->session()->regenerateToken();
                    }
                }
                event(new PasswordReset($user));
            });
        });

        if ($status !== Password::PASSWORD_RESET) {
            throw ValidationException::withMessages(['token' => ['This reset link is invalid or expired. Please request a new link.']]);
        }

        return response()->json(['message' => 'Your password has been reset. Sign in with your new password.']);
    }
}
