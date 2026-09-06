<?php

declare(strict_types=1);

use App\Domain\Authorization\Http\Middleware\ResolveOrganizationContext;
use App\Domain\DeviceProfiles\Http\Controllers\DeviceProfileArtifactController;
use App\Domain\DeviceProfiles\Http\Controllers\DeviceProfileController;
use App\Domain\DeviceProfiles\Http\Controllers\ProfileAlarmTemplateController;
use App\Domain\DeviceProfiles\Http\Controllers\ProfileCalculationController;
use App\Domain\DeviceProfiles\Http\Controllers\ProfileParameterController;
use App\Domain\DeviceProfiles\Http\Controllers\ProfileParameterGroupController;
use App\Domain\DeviceProfiles\Http\Controllers\ProfilePreviewController;
use App\Domain\DeviceProfiles\Http\Controllers\TransportBindingController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1/organizations/{organization}')
    ->name('api.v1.organizations.')
    ->middleware(['auth:sanctum', ResolveOrganizationContext::class])
    ->group(function (): void {
        Route::get('device-profiles', [DeviceProfileController::class, 'index'])->name('device-profiles.index');
        Route::post('device-profiles', [DeviceProfileController::class, 'store'])->name('device-profiles.store');
        Route::get('device-profiles/{profile}', [DeviceProfileController::class, 'show'])->name('device-profiles.show');
        Route::patch('device-profiles/{profile}', [DeviceProfileController::class, 'update'])->name('device-profiles.update');
        Route::delete('device-profiles/{profile}', [DeviceProfileController::class, 'destroy'])->name('device-profiles.destroy');

        Route::post('device-profiles/{profile}/parameter-groups', [ProfileParameterGroupController::class, 'store'])->name('device-profiles.parameter-groups.store');
        Route::patch('device-profiles/{profile}/parameter-groups/{group}', [ProfileParameterGroupController::class, 'update']);
        Route::delete('device-profiles/{profile}/parameter-groups/{group}', [ProfileParameterGroupController::class, 'destroy']);
        Route::put('device-profiles/{profile}/group-order', [ProfileParameterGroupController::class, 'reorder']);
        Route::post('device-profiles/{profile}/preview', ProfilePreviewController::class);
        Route::get('device-profiles/{profile}/artifacts', [DeviceProfileArtifactController::class, 'index']);
        Route::post('device-profiles/{profile}/parameters', [ProfileParameterController::class, 'store'])->name('device-profiles.parameters.store');
        Route::patch('device-profiles/{profile}/parameters/{parameter}', [ProfileParameterController::class, 'update'])->name('device-profiles.parameters.update');
        Route::delete('device-profiles/{profile}/parameters/{parameter}', [ProfileParameterController::class, 'destroy'])->name('device-profiles.parameters.destroy');
        Route::put('device-profiles/{profile}/parameter-order', [ProfileParameterController::class, 'reorder'])->name('device-profiles.parameters.reorder');
        Route::put('device-profiles/{profile}/parameters/{parameter}/calculation', [ProfileCalculationController::class, 'upsert'])->name('device-profiles.parameters.calculation.upsert');
        Route::delete('device-profiles/{profile}/parameters/{parameter}/calculation', [ProfileCalculationController::class, 'destroy'])->name('device-profiles.parameters.calculation.destroy');
        Route::post('device-profiles/{profile}/alarm-templates', [ProfileAlarmTemplateController::class, 'store'])->name('device-profiles.alarm-templates.store');
        Route::patch('device-profiles/{profile}/alarm-templates/{alarm}', [ProfileAlarmTemplateController::class, 'update'])->name('device-profiles.alarm-templates.update');
        Route::delete('device-profiles/{profile}/alarm-templates/{alarm}', [ProfileAlarmTemplateController::class, 'destroy'])->name('device-profiles.alarm-templates.destroy');

        Route::post('device-profiles/{profile}/validate', [DeviceProfileArtifactController::class, 'validate'])->name('device-profiles.validate');
        Route::post('device-profiles/{profile}/compile', [DeviceProfileArtifactController::class, 'compile'])->name('device-profiles.compile');
        Route::post('device-profiles/{profile}/publish', [DeviceProfileArtifactController::class, 'publish'])->name('device-profiles.publish');
        Route::get('device-profiles/{profile}/artifacts/active', [DeviceProfileArtifactController::class, 'active'])->name('device-profiles.artifacts.active');
        Route::get('device-profiles/{profile}/artifacts/{revision}', [DeviceProfileArtifactController::class, 'show'])->whereNumber('revision')->name('device-profiles.artifacts.show');

        Route::get('device-profiles/{profile}/transport-bindings', [TransportBindingController::class, 'index'])->name('transport-bindings.index');
        Route::post('device-profiles/{profile}/transport-bindings', [TransportBindingController::class, 'store'])->name('transport-bindings.store');
        Route::post('device-profiles/{profile}/transport-bindings/{binding}/parameter-mappings', [TransportBindingController::class, 'storeMapping'])->name('transport-bindings.parameter-mappings.store');
        Route::delete('device-profiles/{profile}/transport-bindings/{binding}', [TransportBindingController::class, 'destroy'])->name('transport-bindings.destroy');
    });
