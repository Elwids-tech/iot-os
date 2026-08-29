<?php

declare(strict_types=1);

use App\Domain\Authorization\Http\Middleware\RequireIdempotencyKey;
use App\Domain\Authorization\Http\Middleware\ResolveOrganizationHeaderContext;
use App\Domain\DeviceManagement\Http\Controllers\DeviceController;
use App\Domain\DeviceManagement\Http\Controllers\DeviceDefinitionAssignmentController;
use App\Domain\DeviceProfile\Http\Controllers\DefinitionDraftController;
use App\Domain\DeviceProfile\Http\Controllers\DeviceProfileController;
use App\Domain\DeviceProfile\Http\Controllers\DeviceProfileVersionController;
use App\Domain\DeviceProfile\Http\Controllers\TransportBindingController;
use App\Domain\DeviceProfile\Http\Controllers\TransportBindingVersionController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')
    ->name('api.v1.')
    ->middleware(['auth:sanctum', ResolveOrganizationHeaderContext::class])
    ->group(function (): void {
        Route::get('device-profiles', [DeviceProfileController::class, 'index'])
            ->name('device-profiles.index');
        Route::post('device-profiles', [DeviceProfileController::class, 'store'])
            ->middleware(RequireIdempotencyKey::class)
            ->name('device-profiles.store');
        Route::get('device-profiles/{profile}', [DeviceProfileController::class, 'show'])
            ->name('device-profiles.show');
        Route::patch('device-profiles/{profile}', [DeviceProfileController::class, 'update'])
            ->name('device-profiles.update');
        Route::delete('device-profiles/{profile}', [DeviceProfileController::class, 'destroy'])
            ->name('device-profiles.destroy');
        Route::post('device-profiles/{profile}/archive', [DeviceProfileController::class, 'archive'])
            ->middleware(RequireIdempotencyKey::class)
            ->name('device-profiles.archive');

        Route::get('device-profiles/{profile}/versions', [DeviceProfileVersionController::class, 'index'])
            ->name('device-profile-versions.index');
        Route::post('device-profiles/{profile}/versions', [DeviceProfileVersionController::class, 'store'])
            ->middleware(RequireIdempotencyKey::class)
            ->name('device-profile-versions.store');
        Route::get('device-profile-versions/{version}', [DeviceProfileVersionController::class, 'show'])
            ->name('device-profile-versions.show');
        Route::put('device-profile-versions/{version}', [DeviceProfileVersionController::class, 'update'])
            ->name('device-profile-versions.update');
        Route::delete('device-profile-versions/{version}', [DeviceProfileVersionController::class, 'destroy'])
            ->name('device-profile-versions.destroy');
        Route::post('device-profile-versions/{version}/clone', [DeviceProfileVersionController::class, 'clone'])
            ->middleware(RequireIdempotencyKey::class)
            ->name('device-profile-versions.clone');

        Route::get('transport-bindings', [TransportBindingController::class, 'index'])
            ->name('transport-bindings.index');
        Route::post('transport-bindings', [TransportBindingController::class, 'store'])
            ->middleware(RequireIdempotencyKey::class)
            ->name('transport-bindings.store');
        Route::get('transport-bindings/{binding}', [TransportBindingController::class, 'show'])
            ->name('transport-bindings.show');
        Route::patch('transport-bindings/{binding}', [TransportBindingController::class, 'update'])
            ->name('transport-bindings.update');
        Route::delete('transport-bindings/{binding}', [TransportBindingController::class, 'destroy'])
            ->name('transport-bindings.destroy');
        Route::post('transport-bindings/{binding}/archive', [TransportBindingController::class, 'archive'])
            ->middleware(RequireIdempotencyKey::class)
            ->name('transport-bindings.archive');

        Route::get('transport-bindings/{binding}/versions', [TransportBindingVersionController::class, 'index'])
            ->name('transport-binding-versions.index');
        Route::post('transport-bindings/{binding}/versions', [TransportBindingVersionController::class, 'store'])
            ->middleware(RequireIdempotencyKey::class)
            ->name('transport-binding-versions.store');
        Route::get('transport-binding-versions/{version}', [TransportBindingVersionController::class, 'show'])
            ->name('transport-binding-versions.show');
        Route::put('transport-binding-versions/{version}', [TransportBindingVersionController::class, 'update'])
            ->name('transport-binding-versions.update');
        Route::delete('transport-binding-versions/{version}', [TransportBindingVersionController::class, 'destroy'])
            ->name('transport-binding-versions.destroy');
        Route::post('transport-binding-versions/{version}/clone', [TransportBindingVersionController::class, 'clone'])
            ->middleware(RequireIdempotencyKey::class)
            ->name('transport-binding-versions.clone');

        Route::post('definition-drafts', [DefinitionDraftController::class, 'store'])
            ->middleware(RequireIdempotencyKey::class)
            ->name('definition-drafts.store');
        Route::get('definition-drafts/{bindingVersion}', [DefinitionDraftController::class, 'show'])
            ->name('definition-drafts.show');
        Route::put('definition-drafts/{bindingVersion}', [DefinitionDraftController::class, 'update'])
            ->name('definition-drafts.update');
        Route::post('definition-drafts/{bindingVersion}/validate', [DefinitionDraftController::class, 'validate'])
            ->name('definition-drafts.validate');
        Route::post('definition-drafts/{bindingVersion}/publish', [DefinitionDraftController::class, 'publish'])
            ->middleware(RequireIdempotencyKey::class)
            ->name('definition-drafts.publish');

        Route::get('devices', [DeviceController::class, 'index'])->name('devices.index');
        Route::post('devices', [DeviceController::class, 'store'])
            ->middleware(RequireIdempotencyKey::class)
            ->name('devices.store');
        Route::get('devices/{device}', [DeviceController::class, 'show'])->name('devices.show');
        Route::put('devices/{device}', [DeviceController::class, 'update'])->name('devices.update');
        Route::delete('devices/{device}', [DeviceController::class, 'destroy'])->name('devices.destroy');
        Route::post('devices/{device}/register', [DeviceController::class, 'register'])
            ->middleware(RequireIdempotencyKey::class)
            ->name('devices.register');
        Route::post('devices/{device}/archive', [DeviceController::class, 'archive'])
            ->middleware(RequireIdempotencyKey::class)
            ->name('devices.archive');

        Route::get('devices/{device}/definition-assignment', [DeviceDefinitionAssignmentController::class, 'show'])
            ->name('device-definition-assignments.show');
        Route::put('devices/{device}/definition-assignment', [DeviceDefinitionAssignmentController::class, 'update'])
            ->name('device-definition-assignments.update');
    });
