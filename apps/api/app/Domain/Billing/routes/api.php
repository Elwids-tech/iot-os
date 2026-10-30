<?php

declare(strict_types=1);

use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Billing\Http\Controllers\OwnedBillingAccountController;
use App\Domain\Billing\Http\Controllers\OwnedBillingAccountOrganizationController;
use App\Domain\Billing\Http\Controllers\PlatformBillingAccountController;
use App\Domain\Billing\Http\Controllers\PlatformBillingAccountOwnerController;
use App\Domain\Billing\Http\Controllers\PlatformOrganizationBillingAccountController;
use Illuminate\Support\Facades\Route;

// Billing accounts (spec 023, ADR-026).
Route::prefix('v1')->name('api.v1.')->middleware('auth:sanctum')->group(function (): void {
    Route::prefix('admin')->name('admin.')
        ->middleware('can:'.PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value)
        ->group(function (): void {
            Route::get('billing-accounts', [PlatformBillingAccountController::class, 'index'])
                ->name('billing-accounts.index');
            Route::post('billing-accounts', [PlatformBillingAccountController::class, 'store'])
                ->name('billing-accounts.store');
            Route::get('billing-accounts/{billingAccount}', [PlatformBillingAccountController::class, 'show'])
                ->whereUuid('billingAccount')
                ->name('billing-accounts.show');
            Route::patch('billing-accounts/{billingAccount}', [PlatformBillingAccountController::class, 'update'])
                ->whereUuid('billingAccount')
                ->name('billing-accounts.update');
            Route::delete('billing-accounts/{billingAccount}', [PlatformBillingAccountController::class, 'destroy'])
                ->whereUuid('billingAccount')
                ->name('billing-accounts.destroy');
            Route::put('billing-accounts/{billingAccount}/owners/{user}', [PlatformBillingAccountOwnerController::class, 'update'])
                ->whereUuid('billingAccount')
                ->whereNumber('user')
                ->name('billing-accounts.owners.update');
            Route::delete('billing-accounts/{billingAccount}/owners/{user}', [PlatformBillingAccountOwnerController::class, 'destroy'])
                ->whereUuid('billingAccount')
                ->whereNumber('user')
                ->name('billing-accounts.owners.destroy');
            Route::put('organizations/{organization}/billing-account', [PlatformOrganizationBillingAccountController::class, 'update'])
                ->whereUuid('organization')
                ->name('organizations.billing-account.update');
        });

    // Owners: an account the signed-in person does not own answers 404.
    Route::get('billing-accounts', [OwnedBillingAccountController::class, 'index'])
        ->name('billing-accounts.index');
    Route::post('billing-accounts/{billingAccount}/organizations', [OwnedBillingAccountOrganizationController::class, 'store'])
        ->whereUuid('billingAccount')
        ->name('billing-accounts.organizations.store');
});
