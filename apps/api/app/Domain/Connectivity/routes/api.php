<?php

declare(strict_types=1);

use App\Domain\Authorization\Http\Middleware\ResolveOrganizationContext;
use App\Domain\Connectivity\Http\Controllers\DeviceConnectivityController;
use Illuminate\Support\Facades\Route;

// Device offline alerts (spec 018): settings, state and, later, mutes and recipients.
Route::prefix('v1/organizations/{organization}')->whereUuid(['organization', 'device'])->middleware(['auth:sanctum', ResolveOrganizationContext::class])->group(function (): void {
    Route::get('devices/{device}/connectivity', [DeviceConnectivityController::class, 'show']);
});
