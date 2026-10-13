<?php

declare(strict_types=1);

use App\Domain\Agents\Http\Controllers\AgentAccessController;
use App\Domain\Agents\Http\Controllers\ConnectionController;
use App\Domain\Agents\Http\Controllers\ConsentController;
use App\Domain\Agents\Http\Middleware\RequireAgentAccess;
use App\Domain\Authorization\Http\Middleware\ResolveOrganizationContext;
use Illuminate\Support\Facades\Route;

// Portal endpoints for AI agent access (spec 004). Agents themselves use /mcp (routes/ai.php).
Route::prefix('v1/organizations/{organization}')->whereUuid('organization')
    ->middleware(['auth:sanctum', RequireAgentAccess::class, ResolveOrganizationContext::class])
    ->group(function (): void {
        Route::get('agent-access', [AgentAccessController::class, 'show']);
        Route::put('agent-access', [AgentAccessController::class, 'update']);
        Route::get('agent-connections', [ConnectionController::class, 'index']);
        Route::delete('agent-connections/{connection}', [ConnectionController::class, 'disconnect'])->whereUuid('connection');
        Route::get('agent-connections/{connection}/activity', [ConnectionController::class, 'activity'])->whereUuid('connection');
    });

// The portal's /connect page completes the authorization Passport keeps in the session.
Route::prefix('v1/agent-authorizations')->middleware(['auth:sanctum', RequireAgentAccess::class])->group(function (): void {
    Route::get('current', [ConsentController::class, 'current']);
    Route::post('approve', [ConsentController::class, 'approve']);
    Route::post('deny', [ConsentController::class, 'deny']);
});

// A person's own connected agents, across organizations.
Route::prefix('v1/me/agent-connections')->middleware(['auth:sanctum', RequireAgentAccess::class])->group(function (): void {
    Route::get('', [ConnectionController::class, 'mine']);
    Route::delete('{connection}', [ConnectionController::class, 'disconnectMine'])->whereUuid('connection');
});
