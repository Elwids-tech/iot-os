<?php

declare(strict_types=1);

use App\Domain\Authorization\Http\Middleware\ResolveOrganizationContext;
use App\Domain\Automation\Http\Controllers\AlertController;
use App\Domain\Automation\Http\Controllers\NotificationSettingsController;
use App\Domain\Automation\Http\Controllers\WorkflowController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1/organizations/{organization}/workflows')->middleware(['auth:sanctum', ResolveOrganizationContext::class])->group(function (): void {
    Route::get('node-types', [WorkflowController::class, 'nodeTypes']);
    Route::get('', [WorkflowController::class, 'index']);
    Route::post('', [WorkflowController::class, 'store']);
    Route::get('{workflow}', [WorkflowController::class, 'show']);
    Route::put('{workflow}', [WorkflowController::class, 'update']);
    Route::post('{workflow}/simulate', [WorkflowController::class, 'simulate']);
    Route::post('{workflow}/deployments', [WorkflowController::class, 'deploy']);
    Route::get('{workflow}/deployments/{operation}', [WorkflowController::class, 'deployment']);
    Route::get('{workflow}/transitions', [WorkflowController::class, 'transitions']);
    Route::get('{workflow}/execution', [WorkflowController::class, 'execution']);
    Route::get('{workflow}/notifications', [NotificationSettingsController::class, 'show']);
    Route::put('{workflow}/notifications', [NotificationSettingsController::class, 'update']);
    Route::get('{workflow}/notification-recipients', [NotificationSettingsController::class, 'recipients']);
});

Route::prefix('v1/organizations/{organization}/alerts')->middleware(['auth:sanctum', ResolveOrganizationContext::class])->group(function (): void {
    Route::get('', [AlertController::class, 'index']);
    Route::get('{alert}', [AlertController::class, 'show']);
    Route::post('{alert}/acknowledge', [AlertController::class, 'acknowledge']);
    Route::get('{alert}/comments', [AlertController::class, 'comments']);
    Route::post('{alert}/comments', [AlertController::class, 'comment']);
    Route::get('{alert}/deliveries', [AlertController::class, 'deliveries']);
});
