<?php

declare(strict_types=1);

use App\Domain\Authorization\Http\Middleware\ResolveOrganizationContext;
use App\Domain\Automation\Http\Controllers\WorkflowController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1/organizations/{organization}/workflows')->middleware(['auth:sanctum', ResolveOrganizationContext::class])->group(function (): void {
    Route::get('node-types', [WorkflowController::class, 'nodeTypes']);
    Route::get('', [WorkflowController::class, 'index']);
    Route::post('', [WorkflowController::class, 'store']);
    Route::get('{workflow}', [WorkflowController::class, 'show']);
    Route::put('{workflow}', [WorkflowController::class, 'update']);
    Route::post('{workflow}/simulate', [WorkflowController::class, 'simulate']);
});
