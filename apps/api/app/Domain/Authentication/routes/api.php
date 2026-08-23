<?php

declare(strict_types=1);

use App\Domain\Authentication\Http\Controllers\SessionController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->name('api.v1.')->group(function (): void {
    Route::post('auth/login', [SessionController::class, 'store'])
        ->name('auth.login');

    Route::middleware('auth:sanctum')->group(function (): void {
        Route::get('me', [SessionController::class, 'show'])
            ->name('me');

        Route::post('auth/logout', [SessionController::class, 'destroy'])
            ->name('auth.logout');
    });
});
