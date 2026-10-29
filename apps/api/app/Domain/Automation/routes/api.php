<?php

declare(strict_types=1);

use App\Domain\Authorization\Http\Middleware\ResolveOrganizationContext;
use App\Domain\Automation\Http\Controllers\AlertController;
use App\Domain\Automation\Http\Controllers\AlertNotificationController;
use App\Domain\Automation\Http\Controllers\DagController;
use App\Domain\Automation\Http\Controllers\NotificationSettingsController;
use App\Domain\Automation\Http\Controllers\ScenarioController;
use App\Domain\Automation\Http\Controllers\WorkflowController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1/organizations/{organization}/workflows')->whereUuid(['organization', 'workflow', 'command', 'scenario', 'operation'])->middleware(['auth:sanctum', ResolveOrganizationContext::class])->group(function (): void {
    Route::get('dag/node-types', [DagController::class, 'registry']);
    Route::post('dag/commands/{command}/reconcile', [DagController::class, 'reconcile']);
    Route::get('dag/resources', [DagController::class, 'resources']);
    Route::get('dag/health', [DagController::class, 'health']);
    Route::get('dag', [DagController::class, 'index']);
    Route::post('dag/validate', [DagController::class, 'validateGraph']);
    Route::match(['GET', 'PUT'], 'dag/settings', [DagController::class, 'settings']);
    Route::put('{workflow}/layout', [DagController::class, 'layout']);
    Route::get('{workflow}/actions', [DagController::class, 'history']);
    Route::get('{workflow}/timeline', [DagController::class, 'timeline']);
    Route::get('{workflow}/timeline/{evaluation}', [DagController::class, 'timeline']);
    Route::get('node-types', [WorkflowController::class, 'nodeTypes']);
    Route::get('', [WorkflowController::class, 'index']);
    Route::post('', [WorkflowController::class, 'store']);
    Route::get('{workflow}', [WorkflowController::class, 'show']);
    Route::put('{workflow}', [WorkflowController::class, 'update']);
    Route::get('{workflow}/scenarios', [ScenarioController::class, 'index']);
    Route::post('{workflow}/scenarios', [ScenarioController::class, 'save']);
    Route::put('{workflow}/scenarios/{scenario}', [ScenarioController::class, 'save']);
    Route::delete('{workflow}/scenarios/{scenario}', [ScenarioController::class, 'destroy']);
    Route::get('{workflow}/scenarios/{scenario}/runs', [ScenarioController::class, 'history']);
    Route::post('{workflow}/scenarios/{scenario}/runs', [ScenarioController::class, 'run']);
    Route::post('{workflow}/simulate', [WorkflowController::class, 'simulate']);
    Route::post('{workflow}/deployments', [WorkflowController::class, 'deploy']);
    Route::get('{workflow}/deployments/{operation}', [WorkflowController::class, 'deployment']);
    Route::get('{workflow}/transitions', [WorkflowController::class, 'transitions']);
    Route::get('{workflow}/location-overview', [WorkflowController::class, 'locationOverview']);
    Route::get('{workflow}/alert-overview', [WorkflowController::class, 'alertOverview']);
    Route::get('{workflow}/execution', [WorkflowController::class, 'execution']);
    Route::get('{workflow}/notifications', [NotificationSettingsController::class, 'show']);
    Route::put('{workflow}/notifications', [NotificationSettingsController::class, 'update']);
    Route::get('{workflow}/notification-recipients', [NotificationSettingsController::class, 'recipients']);
});

Route::prefix('v1/organizations/{organization}/alerts')->whereUuid(['organization', 'alert', 'delivery'])->middleware(['auth:sanctum', ResolveOrganizationContext::class])->group(function (): void {
    Route::get('', [AlertController::class, 'index']);
    Route::post('acknowledge', [AlertController::class, 'acknowledgeMany']);
    Route::get('{alert}', [AlertController::class, 'show']);
    Route::post('{alert}/acknowledge', [AlertController::class, 'acknowledge']);
    Route::put('{alert}/assignee', [AlertController::class, 'assign']);
    Route::get('{alert}/comments', [AlertController::class, 'comments']);
    Route::post('{alert}/comments', [AlertController::class, 'comment']);
    Route::post('{alert}/deliveries/{delivery}/retry', [AlertController::class, 'retry']);
    Route::get('{alert}/deliveries', [AlertController::class, 'deliveries']);
});

// The signed-in person's alert notifications: the bell (spec 022).
Route::prefix('v1/organizations/{organization}/alert-notifications')->whereUuid('organization')->middleware(['auth:sanctum', ResolveOrganizationContext::class])->group(function (): void {
    Route::get('', [AlertNotificationController::class, 'index']);
    Route::get('summary', [AlertNotificationController::class, 'summary']);
    Route::post('read', [AlertNotificationController::class, 'read']);
});
