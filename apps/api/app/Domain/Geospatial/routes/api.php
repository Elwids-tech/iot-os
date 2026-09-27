<?php

declare(strict_types=1);

use App\Domain\Authorization\Http\Middleware\ResolveOrganizationContext;
use App\Domain\Geospatial\Http\GeofenceController;
use App\Domain\Geospatial\Http\LocationBindingController;
use App\Domain\Geospatial\Http\LocationMapController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1/organizations/{organization}')->middleware(['auth:sanctum', ResolveOrganizationContext::class])->group(function (): void {
    Route::get('location-bindings', [LocationBindingController::class, 'index']);
    Route::put('location-bindings/{device}', [LocationBindingController::class, 'update']);
    Route::post('location-map/query', [LocationMapController::class, 'query']);
    Route::get('geofences', [GeofenceController::class, 'index']);
    Route::post('geofences', [GeofenceController::class, 'store']);
    Route::get('geofences/{geofence}', [GeofenceController::class, 'show']);
    Route::get('geofences/{geofence}/events', [GeofenceController::class, 'events']);
    Route::put('geofences/{geofence}', [GeofenceController::class, 'update']);
    Route::get('geofences/{geofence}/activations/{batch}', [GeofenceController::class, 'activation']);
    Route::post('geofences/{geofence}/activations/{batch}/items/{item}/retry', [GeofenceController::class, 'retry']);
});
