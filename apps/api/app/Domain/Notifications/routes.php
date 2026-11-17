<?php

use App\Domain\Notifications\Http\Controllers\MonitoringIngestController;
use App\Domain\Notifications\Http\Controllers\NotificationCenterController;
use App\Domain\Notifications\Http\Controllers\PushDeviceController;
use App\Domain\Notifications\Http\Controllers\PushSettingsController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1/notifications')->middleware('auth:sanctum')->group(function (): void {
    Route::get('preferences', [NotificationCenterController::class, 'preferences']);
    Route::put('preferences', [NotificationCenterController::class, 'update']);
    Route::get('events', [NotificationCenterController::class, 'events']);
    // Push alerts (spec 033): personal settings and devices, across organizations.
    Route::get('push', [PushSettingsController::class, 'show']);
    Route::put('push', [PushSettingsController::class, 'update']);
    Route::put('push/organizations/{organization}', [PushSettingsController::class, 'organization']);
    Route::post('push/devices', [PushDeviceController::class, 'store']);
    Route::post('push/devices/sync', [PushDeviceController::class, 'sync']);
    Route::delete('push/devices/{device}', [PushDeviceController::class, 'destroy']);
    Route::post('push/devices/{device}/test', [PushDeviceController::class, 'test'])->middleware('throttle:6,1');
});
Route::prefix('internal/notifications')->group(function (): void {
    Route::post('alertmanager', [MonitoringIngestController::class, 'alertmanager']);
    Route::get('watchdog-preferences', [MonitoringIngestController::class, 'watchdogPreferences']);
    Route::post('watchdog', [MonitoringIngestController::class, 'watchdog']);
});
