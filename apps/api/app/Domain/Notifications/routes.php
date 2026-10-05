<?php

use App\Domain\Notifications\Http\Controllers\MonitoringIngestController;
use App\Domain\Notifications\Http\Controllers\NotificationCenterController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1/notifications')->middleware('auth:sanctum')->group(function (): void {
    Route::get('preferences', [NotificationCenterController::class, 'preferences']);
    Route::put('preferences', [NotificationCenterController::class, 'update']);
    Route::get('events', [NotificationCenterController::class, 'events']);
});
Route::prefix('internal/notifications')->group(function (): void {
    Route::post('alertmanager', [MonitoringIngestController::class, 'alertmanager']);
    Route::get('watchdog-preferences', [MonitoringIngestController::class, 'watchdogPreferences']);
    Route::post('watchdog', [MonitoringIngestController::class, 'watchdog']);
});
