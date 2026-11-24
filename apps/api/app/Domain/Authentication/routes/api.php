<?php

declare(strict_types=1);

use App\Domain\Authentication\Http\Controllers\ConfirmationController;
use App\Domain\Authentication\Http\Controllers\ImpersonationController;
use App\Domain\Authentication\Http\Controllers\PasskeyController;
use App\Domain\Authentication\Http\Controllers\PasskeySignInController;
use App\Domain\Authentication\Http\Controllers\PasswordRecoveryController;
use App\Domain\Authentication\Http\Controllers\SecurityController;
use App\Domain\Authentication\Http\Controllers\SessionController;
use App\Domain\Authentication\Http\Controllers\TwoStepChallengeController;
use App\Domain\Authentication\Http\Controllers\TwoStepController;
use App\Domain\Authentication\Http\Middleware\EnsurePasskeysAvailable;
use App\Domain\Authorization\Http\Controllers\OrganizationContextController;
use App\Domain\Authorization\Http\Middleware\ResolveOrganizationContext;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->name('api.v1.')->group(function (): void {
    Route::post('auth/forgot-password', [PasswordRecoveryController::class, 'request'])
        ->middleware('throttle:password-recovery')->name('auth.forgot-password');
    Route::post('auth/reset-password', [PasswordRecoveryController::class, 'reset'])
        ->middleware('throttle:password-reset')->name('auth.reset-password');
    Route::post('auth/login', [SessionController::class, 'store'])
        ->middleware('throttle:login')->name('auth.login');
    // The second step (spec 034): shares the password step's limiter keys.
    Route::post('auth/two-step', TwoStepChallengeController::class)
        ->middleware('throttle:login')->name('auth.two-step');
    // Passkey sign-in (spec 034): counts as both steps, and 404 where passkeys cannot be used.
    Route::middleware([EnsurePasskeysAvailable::class, 'throttle:passkeys'])->group(function (): void {
        Route::get('auth/passkeys/options', [PasskeySignInController::class, 'options'])->name('auth.passkeys.options');
        Route::post('auth/passkeys', [PasskeySignInController::class, 'store'])->name('auth.passkeys');
    });

    Route::middleware('auth:sanctum')->group(function (): void {
        Route::get('me', [SessionController::class, 'show'])
            ->name('me');

        Route::post('auth/logout', [SessionController::class, 'destroy'])
            ->name('auth.logout');

        // Super administrators act as someone else from the admin app, and leave to return
        // where they started. Only super administrators start it; the service checks.
        Route::post('admin/users/{user}/impersonation', [ImpersonationController::class, 'store'])
            ->whereNumber('user')->middleware('throttle:30,1')->name('admin.users.impersonation.store');
        Route::delete('auth/impersonation', [ImpersonationController::class, 'destroy'])
            ->name('auth.impersonation.destroy');

        // The person's own sign-in security (spec 034). Changes need a password confirmed
        // in the last 15 minutes (`423` otherwise).
        Route::post('auth/confirm-password', [ConfirmationController::class, 'password'])
            ->middleware('throttle:6,1')->name('auth.confirm-password');
        Route::middleware([EnsurePasskeysAvailable::class, 'throttle:passkeys'])->group(function (): void {
            Route::get('auth/confirm-passkey/options', [ConfirmationController::class, 'passkeyOptions'])->name('auth.confirm-passkey.options');
            Route::post('auth/confirm-passkey', [ConfirmationController::class, 'passkey'])->name('auth.confirm-passkey');
        });
        Route::get('me/security', [SecurityController::class, 'show'])->name('me.security');
        Route::post('me/two-step', [TwoStepController::class, 'store'])
            ->middleware('password.confirm')->name('me.two-step.store');
        Route::post('me/two-step/confirm', [TwoStepController::class, 'confirm'])
            ->middleware('throttle:10,1')->name('me.two-step.confirm');
        Route::post('me/two-step/recovery-codes', [TwoStepController::class, 'recoveryCodes'])
            ->middleware('password.confirm')->name('me.two-step.recovery-codes');
        Route::delete('me/two-step', [TwoStepController::class, 'destroy'])
            ->middleware('password.confirm')->name('me.two-step.destroy');
        Route::middleware('password.confirm')->group(function (): void {
            Route::get('me/passkeys/options', [PasskeyController::class, 'options'])
                ->middleware(EnsurePasskeysAvailable::class)->name('me.passkeys.options');
            Route::post('me/passkeys', [PasskeyController::class, 'store'])
                ->middleware(EnsurePasskeysAvailable::class)->name('me.passkeys.store');
            // Removing stays possible where passkeys cannot be used any more.
            Route::delete('me/passkeys/{passkey}', [PasskeyController::class, 'destroy'])
                ->whereNumber('passkey')->name('me.passkeys.destroy');
        });

        Route::get('organizations/{organization}/context', [OrganizationContextController::class, 'show'])
            ->whereUuid('organization')
            ->middleware(ResolveOrganizationContext::class)
            ->name('organizations.context');
    });
});

require __DIR__.'/../../Administration/routes/api.php';
require __DIR__.'/../../DeviceProfiles/routes/api.php';
require __DIR__.'/../../Devices/routes/api.php';
require __DIR__.'/../../Dashboards/routes/api.php';
