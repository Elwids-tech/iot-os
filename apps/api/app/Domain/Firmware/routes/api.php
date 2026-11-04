<?php

declare(strict_types=1);

use App\Domain\Authorization\Http\Middleware\ResolveOrganizationContext;
use App\Domain\Firmware\Http\Controllers\ConnectionSettingsController;
use App\Domain\Firmware\Http\Controllers\FirmwareKitController;
use App\Domain\Firmware\Http\Controllers\FirmwareStarterController;
use App\Domain\Firmware\Http\Controllers\FirmwareTargetController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1/organizations/{organization}')->whereUuid(['organization', 'device', 'gateway'])->middleware(['auth:sanctum', ResolveOrganizationContext::class])->group(function (): void {
    Route::get('firmware/targets', [FirmwareTargetController::class, 'index']);
    Route::post('firmware/starters', [FirmwareStarterController::class, 'store'])->middleware('throttle:10,1');
    Route::post('devices/{device}/connection-settings', [ConnectionSettingsController::class, 'device'])->middleware('throttle:10,1');
    Route::post('gateways/{gateway}/connection-settings', [ConnectionSettingsController::class, 'gateway'])->middleware('throttle:10,1');
    Route::post('devices/{device}/firmware-kit', [FirmwareKitController::class, 'device'])->middleware('throttle:10,1');
    Route::post('gateways/{gateway}/firmware-kit', [FirmwareKitController::class, 'gateway'])->middleware('throttle:10,1');
});
