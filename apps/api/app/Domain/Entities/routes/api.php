<?php

declare(strict_types=1);

use App\Domain\Authorization\Http\Middleware\ResolveOrganizationContext;
use App\Domain\Entities\Http\Controllers\EntityController;
use App\Domain\Entities\Http\Controllers\EntityPresetController;
use App\Domain\Entities\Http\Controllers\EntityTypeController;
use App\Domain\Entities\Http\Controllers\PlacementController;
use App\Domain\Entities\Http\Controllers\PointController;
use Illuminate\Support\Facades\Route;

// The entity hierarchy (spec 009, contracts/api.md).
Route::prefix('v1/organizations/{organization}')->whereUuid(['organization', 'entity', 'type', 'device', 'parameter'])->middleware(['auth:sanctum', ResolveOrganizationContext::class])->group(function (): void {
    Route::get('entity-types', [EntityTypeController::class, 'index']);
    Route::post('entity-types', [EntityTypeController::class, 'store']);
    Route::patch('entity-types/{type}', [EntityTypeController::class, 'update']);
    Route::delete('entity-types/{type}', [EntityTypeController::class, 'destroy']);
    Route::get('entity-presets', [EntityPresetController::class, 'index']);
    Route::post('entity-presets/{preset}/apply', [EntityPresetController::class, 'apply'])->where('preset', '[a-z_]+');
    Route::get('entities', [EntityController::class, 'index']);
    Route::get('entities/search', [EntityController::class, 'search'])->middleware('throttle:120,1');
    Route::get('entities/path-name-suggestion', [EntityController::class, 'pathNameSuggestion']);
    Route::post('entities', [EntityController::class, 'store']);
    Route::get('entities/{entity}', [EntityController::class, 'show']);
    Route::patch('entities/{entity}', [EntityController::class, 'update']);
    Route::get('entities/{entity}/move-impact', [EntityController::class, 'moveImpact']);
    Route::post('entities/{entity}/move', [EntityController::class, 'move']);
    Route::post('entities/{entity}/archive', [EntityController::class, 'archive']);
    Route::post('entities/{entity}/restore', [EntityController::class, 'restore']);
    Route::delete('entities/{entity}', [EntityController::class, 'destroy']);
    Route::get('entities/{entity}/devices', [PlacementController::class, 'devices']);
    Route::get('devices/{device}/placements', [PlacementController::class, 'index']);
    Route::put('devices/{device}/placement', [PlacementController::class, 'update']);
    Route::delete('devices/{device}/placement', [PlacementController::class, 'destroy']);
    Route::get('entities/{entity}/points', [PointController::class, 'index']);
    Route::put('devices/{device}/parameters/{parameter}/placement', [PointController::class, 'update']);
    Route::delete('devices/{device}/parameters/{parameter}/placement', [PointController::class, 'destroy']);
});
