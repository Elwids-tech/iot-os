<?php

use App\Domain\Authorization\Http\Middleware\ResolveOrganizationContext;
use App\Domain\Integrations\Http\ApplicationController;
use App\Domain\Integrations\Http\AuthenticateApplication;
use App\Domain\Integrations\Http\ReadController;
use App\Domain\Integrations\Http\EventController;
use App\Domain\Integrations\Http\WebhookController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1/organizations/{organization}/applications')->middleware(['auth:sanctum', ResolveOrganizationContext::class, 'throttle:30,1'])->group(function (): void {
    Route::get('{application}/webhook', [WebhookController::class, 'show']);
    Route::put('{application}/webhook', [WebhookController::class, 'configure']);
    Route::post('{application}/webhook/disable', [WebhookController::class, 'disable']);
    Route::get('{application}/webhook/deliveries', [WebhookController::class, 'deliveries']);
    Route::post('{application}/webhook/deliveries/{delivery}/retry', [WebhookController::class, 'retry']);
    Route::get('', [ApplicationController::class, 'index']);
    Route::post('', [ApplicationController::class, 'store']);
    Route::put('{application}', [ApplicationController::class, 'update']);
    Route::post('{application}/token', [ApplicationController::class, 'rotate']);
    Route::post('{application}/revoke', [ApplicationController::class, 'revoke']);
});
Route::prefix('integration/v1/organizations/{organization}')->middleware('throttle:240,1')->group(function (): void {
    Route::get('events/checkpoint', [EventController::class, 'checkpoint'])->middleware(AuthenticateApplication::class.':events:read');
    Route::get('events', [EventController::class, 'index'])->middleware(AuthenticateApplication::class.':events:read');
    Route::get('devices/{uuid}/telemetry/records', [\App\Domain\Integrations\Http\TelemetryController::class, 'records'])->middleware(AuthenticateApplication::class.':telemetry:read');
    Route::get('devices/{uuid}/location-bindings', [\App\Domain\Integrations\Http\LocationController::class, 'bindings'])->middleware(AuthenticateApplication::class.':telemetry:read');
    Route::get('devices/{uuid}/locations/{event}', [\App\Domain\Integrations\Http\LocationController::class, 'show'])->middleware(AuthenticateApplication::class.':telemetry:read');
    Route::get('devices/{uuid}/telemetry/latest', [\App\Domain\Integrations\Http\TelemetryController::class, 'latest'])->middleware(AuthenticateApplication::class.':telemetry:read');
    Route::get('devices/{uuid}/telemetry/history', [\App\Domain\Integrations\Http\TelemetryController::class, 'history'])->middleware(AuthenticateApplication::class.':telemetry:read');
    Route::get('devices', [ReadController::class, 'devices'])->middleware(AuthenticateApplication::class.':devices:read');
    Route::get('devices/{uuid}', [ReadController::class, 'device'])->middleware(AuthenticateApplication::class.':devices:read');
    Route::get('alerts', [ReadController::class, 'alerts'])->middleware(AuthenticateApplication::class.':alerts:read');
    Route::get('alerts/{uuid}', [ReadController::class, 'alert'])->middleware(AuthenticateApplication::class.':alerts:read');
});
