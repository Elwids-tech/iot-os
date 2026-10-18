<?php

declare(strict_types=1);

use App\Domain\Authorization\Http\Middleware\ResolveOrganizationContext;
use App\Domain\Support\Http\Controllers\AdminTicketController;
use App\Domain\Support\Http\Controllers\TicketController;
use App\Domain\Support\Http\Controllers\TicketMessageController;
use App\Domain\Support\Http\Controllers\TicketParticipantController;
use Illuminate\Support\Facades\Route;

// Support tickets (spec 015): members file and follow them in their organization.
Route::prefix('v1/organizations/{organization}')
    ->whereUuid(['organization', 'ticket', 'attachment'])
    ->middleware(['auth:sanctum', ResolveOrganizationContext::class])
    ->group(function (): void {
        Route::get('tickets', [TicketController::class, 'index']);
        Route::post('tickets', [TicketController::class, 'store'])->middleware('throttle:support-tickets');
        Route::get('tickets/summary', [TicketController::class, 'summary']);
        Route::get('tickets/{ticket}', [TicketController::class, 'show']);
        Route::patch('tickets/{ticket}', [TicketController::class, 'update']);
        Route::post('tickets/{ticket}/messages', [TicketMessageController::class, 'store'])->middleware('throttle:support-messages');
        Route::post('tickets/{ticket}/read', [TicketController::class, 'read']);
        Route::get('tickets/{ticket}/attachments/{attachment}', [TicketController::class, 'attachment']);
        Route::get('tickets/{ticket}/people', [TicketController::class, 'people']);
        Route::put('tickets/{ticket}/participants/{user}', [TicketParticipantController::class, 'update'])->whereNumber('user');
        Route::delete('tickets/{ticket}/participants/{user}', [TicketParticipantController::class, 'destroy'])->whereNumber('user');
    });

// The team's queue in the admin app: super administrators only.
Route::prefix('v1/admin/tickets')
    ->whereUuid(['ticket', 'attachment'])
    ->middleware('auth:sanctum')
    ->group(function (): void {
        Route::get('/', [AdminTicketController::class, 'index']);
        Route::get('summary', [AdminTicketController::class, 'summary']);
        Route::get('assignees', [AdminTicketController::class, 'assignees']);
        Route::get('{ticket}', [AdminTicketController::class, 'show']);
        Route::patch('{ticket}', [AdminTicketController::class, 'update']);
        Route::delete('{ticket}', [AdminTicketController::class, 'destroy']);
        Route::post('{ticket}/messages', [AdminTicketController::class, 'message']);
        Route::post('{ticket}/read', [AdminTicketController::class, 'read']);
        Route::get('{ticket}/attachments/{attachment}', [AdminTicketController::class, 'attachment']);
        Route::get('{ticket}/people', [AdminTicketController::class, 'people']);
        Route::put('{ticket}/participants/{user}', [AdminTicketController::class, 'addParticipant'])->whereNumber('user');
        Route::delete('{ticket}/participants/{user}', [AdminTicketController::class, 'removeParticipant'])->whereNumber('user');
    });
