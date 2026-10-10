<?php

declare(strict_types=1);

use App\Domain\Authorization\Http\Middleware\ResolveOrganizationContext;
use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Devices\Http\Controllers\CommandController;
use App\Domain\Devices\Http\Controllers\DeviceController;
use App\Domain\Devices\Http\Controllers\DiscoveryController;
use App\Domain\Devices\Http\Controllers\OnboardingController;
use App\Domain\Devices\Http\Controllers\RetentionController;
use App\Domain\Devices\Http\Controllers\RuntimeController;
use App\Domain\Devices\Http\Controllers\RuntimeStatusController;
use App\Domain\Devices\Http\Controllers\SiteController;
use App\Domain\Devices\Http\Controllers\TelemetryCaptureController;
use App\Domain\Devices\Http\Middleware\AuthenticateDeviceRuntime;
use Illuminate\Support\Facades\Route;

Route::prefix('v1/organizations/{organization}')->middleware(['auth:sanctum', ResolveOrganizationContext::class])->group(function (): void {
    Route::get('telemetry-captures', [TelemetryCaptureController::class, 'index']);
    Route::post('telemetry-captures', [TelemetryCaptureController::class, 'store'])->middleware('throttle:20,1');
    Route::get('telemetry-captures/{capture}', [TelemetryCaptureController::class, 'show'])->whereUuid('capture');
    Route::post('telemetry-captures/{capture}', [TelemetryCaptureController::class, 'update'])->whereUuid('capture');
    Route::post('telemetry-captures/{capture}/diagnose', [TelemetryCaptureController::class, 'diagnose'])->whereUuid('capture')->middleware('throttle:6,1');
    Route::get('runtime-status', RuntimeStatusController::class);
    Route::get('devices', [DeviceController::class, 'index']);
    Route::post('device-onboardings', [OnboardingController::class, 'store'])->middleware('throttle:20,1');
    Route::get('devices/{device}/onboarding', [OnboardingController::class, 'show']);
    Route::post('devices/{device}/onboarding/provision', [OnboardingController::class, 'provision'])->middleware('throttle:10,1');
    Route::post('devices/{device}/connection-kit', [OnboardingController::class, 'kit'])->middleware('throttle:10,1');
    Route::get('devices/{device}/connection-kit/archive', [OnboardingController::class, 'archive'])->middleware('throttle:10,1');
    Route::post('devices', [DeviceController::class, 'store']);
    Route::get('devices/{device}', [DeviceController::class, 'show']);
    Route::patch('devices/{device}', [DeviceController::class, 'update']);
    Route::post('devices/{device}/archive', [DeviceController::class, 'archive']);
    Route::put('devices/{device}/configuration', [DeviceController::class, 'saveConfiguration']);
    Route::get('devices/{device}/mapping-suggestions', [DeviceController::class, 'mappingSuggestions']);
    Route::post('devices/{device}/validate', [DeviceController::class, 'validateConfiguration']);
    Route::post('devices/{device}/lifecycle', [DeviceController::class, 'lifecycle']);
    Route::get('devices/{device}/operations/{operation}', [DeviceController::class, 'operation']);
    Route::post('devices/{device}/activate', [DeviceController::class, 'activate']);
    Route::post('devices/{device}/deactivate', [DeviceController::class, 'deactivate']);
    Route::get('sites', [SiteController::class, 'index']);
    Route::post('sites', [SiteController::class, 'store']);
    Route::patch('sites/{site}', [SiteController::class, 'update']);
    Route::delete('sites/{site}', [SiteController::class, 'destroy']);
    Route::put('settings/timezone', [SiteController::class, 'updateOrganizationTimezone']);
    Route::get('devices/{device}/measurements/latest', [DeviceController::class, 'latest']);
    Route::get('devices/{device}/measurements/history', [DeviceController::class, 'history']);
    Route::get('devices/{device}/measurements/records', [DeviceController::class, 'historyRecords']);
    Route::get('devices/{device}/measurements/state-history', [DeviceController::class, 'stateHistory']);
    Route::get('devices/{device}/measurements/increase', [DeviceController::class, 'counterIncrease']);
    Route::get('devices/{device}/commands', [CommandController::class, 'index']);
    Route::post('devices/{device}/commands', [CommandController::class, 'prepare']);
    Route::post('devices/{device}/commands/send', [CommandController::class, 'send']);
    Route::post('devices/{device}/commands/{command}/confirm', [CommandController::class, 'confirm']);
    Route::post('devices/{device}/commands/{command}/cancel', [CommandController::class, 'cancel']);
    Route::get('sparkplug-connections', [DiscoveryController::class, 'connections']);
    Route::post('sparkplug-connections', [DiscoveryController::class, 'storeConnection']);
    Route::post('sparkplug-connections/{connection}/provision', [DiscoveryController::class, 'provisionConnection']);
    Route::get('gateways', [DiscoveryController::class, 'gateways']);
    Route::post('gateways', [DiscoveryController::class, 'storeGateway']);
    Route::post('gateways/{gateway}/provision', [DiscoveryController::class, 'provisionGateway']);
    Route::get('discovery-candidates', [DiscoveryController::class, 'candidates']);
    Route::get('discovery-candidates/{candidate}', [DiscoveryController::class, 'candidate']);
    Route::patch('discovery-candidates/{candidate}', [DiscoveryController::class, 'review']);
});

Route::prefix('v1/admin')->middleware(['auth:sanctum', 'can:'.PlatformAdministrationPermission::MANAGE_RETENTION->value])->group(function (): void {
    Route::get('settings/telemetry-retention', [RetentionController::class, 'show']);
    Route::put('settings/telemetry-retention', [RetentionController::class, 'update']);
    Route::get('organizations/{organization}/settings/telemetry-retention', [RetentionController::class, 'show']);
    Route::put('organizations/{organization}/settings/telemetry-retention', [RetentionController::class, 'update']);
});

Route::prefix('internal/devices')->middleware(AuthenticateDeviceRuntime::class)->group(function (): void {
    Route::get('state', [RuntimeController::class, 'state']);
    Route::post('outbox/claim', [RuntimeController::class, 'claim']);
    Route::post('outbox/{event}/ack', [RuntimeController::class, 'ack']);
    Route::post('automation-command-check', [RuntimeController::class, 'automationCommandCheck']);
    Route::post('events', [RuntimeController::class, 'event']);
});
