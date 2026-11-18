<?php

declare(strict_types=1);

use App\Domain\SignUp\Http\Controllers\PlatformSignUpController;
use App\Domain\SignUp\Http\Controllers\SignUpController;
use App\Domain\SignUp\Http\Controllers\SignUpSettingsController;
use Illuminate\Support\Facades\Route;

// Self sign-up (spec 035, contracts/sign-up-api.md). Guest routes: each reaches only the
// sign-up this browser submitted, or the one a link's token names.
Route::prefix('v1')->name('api.v1.')->group(function (): void {
    Route::get('sign-up', [SignUpController::class, 'show'])->name('sign-up.show');
    Route::post('sign-up', [SignUpController::class, 'store'])->middleware('throttle:sign-up')->name('sign-up.store');
    Route::get('sign-up/status', [SignUpController::class, 'status'])->middleware('throttle:sign-up-status')->name('sign-up.status');
    Route::post('sign-up/resend', [SignUpController::class, 'resend'])->middleware('throttle:sign-up-resend')->name('sign-up.resend');
    Route::post('sign-up/confirm', [SignUpController::class, 'confirm'])->middleware('throttle:sign-up-confirm')->name('sign-up.confirm');

    Route::middleware('auth:sanctum')->prefix('admin')->name('admin.')->group(function (): void {
        Route::get('sign-up-settings', [SignUpSettingsController::class, 'show'])->name('sign-up-settings.show');
        Route::put('sign-up-settings', [SignUpSettingsController::class, 'update'])->name('sign-up-settings.update');
        Route::get('sign-ups', [PlatformSignUpController::class, 'index'])->name('sign-ups.index');
    });
});
