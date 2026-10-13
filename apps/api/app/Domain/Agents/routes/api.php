<?php

declare(strict_types=1);

use App\Domain\Agents\Http\Controllers\AgentAccessController;
use App\Domain\Agents\Http\Middleware\RequireAgentAccess;
use App\Domain\Authorization\Http\Middleware\ResolveOrganizationContext;
use Illuminate\Support\Facades\Route;

// Portal endpoints for AI agent access (spec 004). Agents themselves use /mcp (routes/ai.php).
Route::prefix('v1/organizations/{organization}')->whereUuid('organization')
    ->middleware(['auth:sanctum', RequireAgentAccess::class, ResolveOrganizationContext::class])
    ->group(function (): void {
        Route::get('agent-access', [AgentAccessController::class, 'show']);
        Route::put('agent-access', [AgentAccessController::class, 'update']);
    });
