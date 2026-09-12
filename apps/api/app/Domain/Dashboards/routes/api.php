<?php

declare(strict_types=1);

use App\Domain\Authorization\Http\Middleware\ResolveOrganizationContext;
use App\Domain\Dashboards\Http\Controllers\DashboardController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1/organizations/{organization}')->middleware(['auth:sanctum', ResolveOrganizationContext::class])->group(function (): void {
    Route::get('dashboards', [DashboardController::class, 'index']);
    Route::post('dashboards', [DashboardController::class, 'store']);
    Route::get('dashboards/{dashboard}', [DashboardController::class, 'show']);
    Route::put('dashboards/{dashboard}', [DashboardController::class, 'update']);
    Route::delete('dashboards/{dashboard}', [DashboardController::class, 'destroy']);
});
