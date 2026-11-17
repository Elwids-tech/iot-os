<?php

declare(strict_types=1);

use App\Domain\Authentication\Http\Controllers\ConfirmationController;
use App\Domain\Authentication\Http\Controllers\PasswordRecoveryController;
use App\Domain\Authentication\Http\Controllers\SecurityController;
use App\Domain\Authentication\Http\Controllers\SessionController;
use App\Domain\Authentication\Http\Controllers\TwoStepChallengeController;
use App\Domain\Authentication\Http\Controllers\TwoStepController;
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

    Route::middleware('auth:sanctum')->group(function (): void {
        Route::get('me', [SessionController::class, 'show'])
            ->name('me');

        Route::post('auth/logout', [SessionController::class, 'destroy'])
            ->name('auth.logout');

        // The person's own sign-in security (spec 034). Changes need a password confirmed
        // in the last 15 minutes (`423` otherwise).
        Route::post('auth/confirm-password', [ConfirmationController::class, 'password'])
            ->middleware('throttle:6,1')->name('auth.confirm-password');
        Route::get('me/security', [SecurityController::class, 'show'])->name('me.security');
        Route::post('me/two-step', [TwoStepController::class, 'store'])
            ->middleware('password.confirm')->name('me.two-step.store');
        Route::post('me/two-step/confirm', [TwoStepController::class, 'confirm'])
            ->middleware('throttle:10,1')->name('me.two-step.confirm');
        Route::post('me/two-step/recovery-codes', [TwoStepController::class, 'recoveryCodes'])
            ->middleware('password.confirm')->name('me.two-step.recovery-codes');
        Route::delete('me/two-step', [TwoStepController::class, 'destroy'])
            ->middleware('password.confirm')->name('me.two-step.destroy');

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
