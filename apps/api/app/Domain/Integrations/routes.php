<?php

use App\Domain\Authorization\Http\Middleware\ResolveOrganizationContext;
use App\Domain\Integrations\Http\ApplicationController;
use App\Domain\Integrations\Http\AuthenticateApplication;
use App\Domain\Integrations\Http\ReadController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1/organizations/{organization}/applications')->middleware(['auth:sanctum', ResolveOrganizationContext::class, 'throttle:30,1'])->group(function (): void {
    Route::get('', [ApplicationController::class, 'index']);
    Route::post('', [ApplicationController::class, 'store']);
    Route::put('{application}', [ApplicationController::class, 'update']);
    Route::post('{application}/token', [ApplicationController::class, 'rotate']);
    Route::post('{application}/revoke', [ApplicationController::class, 'revoke']);
});
Route::prefix('integration/v1/organizations/{organization}')->middleware('throttle:240,1')->group(function (): void {
    Route::get('devices', [ReadController::class, 'devices'])->middleware(AuthenticateApplication::class.':devices:read');
    Route::get('devices/{uuid}', [ReadController::class, 'device'])->middleware(AuthenticateApplication::class.':devices:read');
    Route::get('alerts', [ReadController::class, 'alerts'])->middleware(AuthenticateApplication::class.':alerts:read');
    Route::get('alerts/{uuid}', [ReadController::class, 'alert'])->middleware(AuthenticateApplication::class.':alerts:read');
});
