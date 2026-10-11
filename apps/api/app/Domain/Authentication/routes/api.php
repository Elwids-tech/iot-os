<?php

declare(strict_types=1);

use App\Domain\Authentication\Http\Controllers\PasswordRecoveryController;
use App\Domain\Authentication\Http\Controllers\SessionController;
use App\Domain\Authorization\Http\Controllers\OrganizationContextController;
use App\Domain\Authorization\Http\Middleware\ResolveOrganizationContext;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->name('api.v1.')->group(function (): void {
    Route::post('auth/forgot-password', [PasswordRecoveryController::class, 'request'])
        ->middleware('throttle:password-recovery')->name('auth.forgot-password');
    Route::post('auth/reset-password', [PasswordRecoveryController::class, 'reset'])
        ->middleware('throttle:password-reset')->name('auth.reset-password');
    Route::post('auth/login', [SessionController::class, 'store'])
        ->name('auth.login');

    Route::middleware('auth:sanctum')->group(function (): void {
        Route::get('me', [SessionController::class, 'show'])
            ->name('me');

        Route::post('auth/logout', [SessionController::class, 'destroy'])
            ->name('auth.logout');

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
