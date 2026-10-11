<?php

use App\Domain\Assistant\Http\Controllers\AssistantController;
use App\Domain\Authorization\Http\Middleware\ResolveOrganizationContext;
use Illuminate\Support\Facades\Route;

Route::prefix('v1/organizations/{organization}/assistant')->whereUuid(['organization', 'conversation', 'source', 'proposal', 'run'])->middleware(['auth:sanctum', ResolveOrganizationContext::class])->group(function (): void {
    Route::get('settings', [AssistantController::class, 'settings']);
    Route::get('conversations', [AssistantController::class, 'index']);
    Route::post('conversations', [AssistantController::class, 'store'])->middleware('throttle:30,1');
    Route::get('conversations/{conversation}', [AssistantController::class, 'show']);
    Route::delete('conversations/{conversation}', [AssistantController::class, 'destroy']);
    Route::get('conversations/{conversation}/events', [AssistantController::class, 'events']);
    Route::post('conversations/{conversation}/messages', [AssistantController::class, 'message'])->middleware('throttle:20,1');
    Route::post('conversations/{conversation}/sources', [AssistantController::class, 'upload'])->middleware('throttle:20,1');
    Route::get('conversations/{conversation}/sources/{source}', [AssistantController::class, 'source']);
    Route::post('conversations/{conversation}/proposals', [AssistantController::class, 'preview']);
    Route::post('conversations/{conversation}/proposals/{proposal}/decision', [AssistantController::class, 'decide']);
    Route::post('conversations/{conversation}/runs/{run}/cancel', [AssistantController::class, 'cancel']);
});
