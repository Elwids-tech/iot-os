<?php

declare(strict_types=1);

use App\Domain\Authorization\Http\Middleware\ResolveOrganizationContext;
use App\Domain\Dashboards\Http\Controllers\DashboardController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1/organizations/{organization}')->whereUuid(['organization', 'dashboard'])->middleware(['auth:sanctum', ResolveOrganizationContext::class])->group(function (): void {
    Route::get('dashboards', [DashboardController::class, 'index']);
    Route::post('dashboards', [DashboardController::class, 'store']);
    Route::get('dashboards/{dashboard}', [DashboardController::class, 'show']);
    Route::put('dashboards/{dashboard}', [DashboardController::class, 'update']);
    Route::delete('dashboards/{dashboard}', [DashboardController::class, 'destroy']);
    Route::put('dashboards/{dashboard}/star', [DashboardController::class, 'star']);
    Route::post('dashboards/{dashboard}/duplicate', [DashboardController::class, 'duplicate']);
    Route::get('dashboards/{dashboard}/revisions', [DashboardController::class, 'revisions']);
    Route::get('dashboards/{dashboard}/revisions/{number}', [DashboardController::class, 'revision'])->where('number', '[0-9]{1,9}');
    Route::post('dashboards/{dashboard}/revisions/{number}/restore', [DashboardController::class, 'restore'])->where('number', '[0-9]{1,9}');
    Route::get('dashboards/{dashboard}/access', [DashboardController::class, 'access']);
    Route::put('dashboards/{dashboard}/access', [DashboardController::class, 'updateAccess']);
    Route::get('dashboard-share-targets', [DashboardController::class, 'shareTargets']);
});
