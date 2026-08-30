<?php

declare(strict_types=1);

use App\Domain\Authentication\Http\Controllers\SessionController;
use App\Domain\Authorization\Http\Controllers\OrganizationContextController;
use App\Domain\Authorization\Http\Middleware\ResolveOrganizationContext;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->name('api.v1.')->middleware('web')->withoutMiddleware(ValidateCsrfToken::class)->group(function (): void {
    Route::post('auth/login', [SessionController::class, 'store'])
        ->name('auth.login');

    Route::middleware('auth:sanctum')->group(function (): void {
        Route::get('me', [SessionController::class, 'show'])
            ->name('me');

        Route::post('auth/logout', [SessionController::class, 'destroy'])
            ->name('auth.logout');

        Route::get('organizations/{organization}/context', [OrganizationContextController::class, 'show'])
            ->middleware(ResolveOrganizationContext::class)
            ->name('organizations.context');
    });
});

require __DIR__.'/../../Administration/routes/api.php';
