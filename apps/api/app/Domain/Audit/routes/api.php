<?php

declare(strict_types=1);

use App\Domain\Audit\Http\Controllers\PlatformActivityController;
use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use Illuminate\Support\Facades\Route;

// The activity log (spec 024, ADR-028).
Route::prefix('v1/admin')->name('api.v1.admin.')
    ->middleware(['auth:sanctum', 'can:'.PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value])
    ->group(function (): void {
        Route::get('activity', [PlatformActivityController::class, 'index'])->name('activity.index');
    });
