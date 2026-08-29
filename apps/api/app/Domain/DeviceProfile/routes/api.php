<?php

declare(strict_types=1);

use App\Domain\Authorization\Http\Middleware\RequireIdempotencyKey;
use App\Domain\Authorization\Http\Middleware\ResolveOrganizationHeaderContext;
use App\Domain\DeviceManagement\Http\Controllers\DeviceController;
use App\Domain\DeviceManagement\Http\Controllers\DeviceDefinitionAssignmentController;
use App\Domain\DeviceManagement\Http\Controllers\GatewayController;
use App\Domain\DeviceManagement\Http\Controllers\GatewayRouteController;
use App\Domain\DeviceProfile\Http\Controllers\DeviceProfileController;
use App\Domain\DeviceProfile\Http\Controllers\NativeMqttBindingController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')
    ->name('api.v1.')
    ->middleware(['auth:sanctum', ResolveOrganizationHeaderContext::class])
    ->group(function (): void {
        Route::get('device-profiles', [DeviceProfileController::class, 'index'])
            ->name('device-profiles.index');
        Route::post('device-profiles', [DeviceProfileController::class, 'store'])
            ->middleware(RequireIdempotencyKey::class)
            ->name('device-profiles.store');
        Route::get('device-profiles/{profile}', [DeviceProfileController::class, 'show'])
            ->name('device-profiles.show');
        Route::put('device-profiles/{profile}', [DeviceProfileController::class, 'update'])
            ->name('device-profiles.update');
        Route::delete('device-profiles/{profile}', [DeviceProfileController::class, 'destroy'])
            ->name('device-profiles.destroy');

        Route::get('native-mqtt-bindings', [NativeMqttBindingController::class, 'index'])
            ->name('native-mqtt-bindings.index');
        Route::post('native-mqtt-bindings', [NativeMqttBindingController::class, 'store'])
            ->middleware(RequireIdempotencyKey::class)
            ->name('native-mqtt-bindings.store');
        Route::get('native-mqtt-bindings/{binding}', [NativeMqttBindingController::class, 'show'])
            ->name('native-mqtt-bindings.show');
        Route::put('native-mqtt-bindings/{binding}', [NativeMqttBindingController::class, 'update'])
            ->name('native-mqtt-bindings.update');
        Route::delete('native-mqtt-bindings/{binding}', [NativeMqttBindingController::class, 'destroy'])
            ->name('native-mqtt-bindings.destroy');

        Route::get('devices', [DeviceController::class, 'index'])
            ->name('devices.index');
        Route::post('devices', [DeviceController::class, 'store'])
            ->middleware(RequireIdempotencyKey::class)
            ->name('devices.store');
        Route::get('devices/{device}', [DeviceController::class, 'show'])
            ->name('devices.show');
        Route::put('devices/{device}', [DeviceController::class, 'update'])
            ->name('devices.update');
        Route::delete('devices/{device}', [DeviceController::class, 'destroy'])
            ->name('devices.destroy');
        Route::post('devices/{device}/register', [DeviceController::class, 'register'])
            ->middleware(RequireIdempotencyKey::class)
            ->name('devices.register');
        Route::post('devices/{device}/archive', [DeviceController::class, 'archive'])
            ->middleware(RequireIdempotencyKey::class)
            ->name('devices.archive');

        Route::get('devices/{device}/definition-assignment', [DeviceDefinitionAssignmentController::class, 'show'])
            ->name('device-definition-assignments.show');
        Route::put('devices/{device}/definition-assignment', [DeviceDefinitionAssignmentController::class, 'update'])
            ->name('device-definition-assignments.update');

        Route::get('gateways', [GatewayController::class, 'index'])
            ->name('gateways.index');
        Route::post('gateways', [GatewayController::class, 'store'])
            ->middleware(RequireIdempotencyKey::class)
            ->name('gateways.store');
        Route::get('gateways/{gateway}', [GatewayController::class, 'show'])
            ->name('gateways.show');
        Route::put('gateways/{gateway}', [GatewayController::class, 'update'])
            ->name('gateways.update');
        Route::delete('gateways/{gateway}', [GatewayController::class, 'destroy'])
            ->name('gateways.destroy');

        Route::get('gateway-routes', [GatewayRouteController::class, 'index'])
            ->name('gateway-routes.index');
        Route::post('gateway-routes', [GatewayRouteController::class, 'store'])
            ->middleware(RequireIdempotencyKey::class)
            ->name('gateway-routes.store');
        Route::get('gateway-routes/{route}', [GatewayRouteController::class, 'show'])
            ->name('gateway-routes.show');
        Route::put('gateway-routes/{route}', [GatewayRouteController::class, 'update'])
            ->name('gateway-routes.update');
        Route::delete('gateway-routes/{route}', [GatewayRouteController::class, 'destroy'])
            ->name('gateway-routes.destroy');
    });
