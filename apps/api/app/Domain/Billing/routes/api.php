<?php

declare(strict_types=1);

use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Http\Controllers\OwnedBillingAccountController;
use App\Domain\Billing\Http\Controllers\OwnedBillingAccountOrganizationController;
use App\Domain\Billing\Http\Controllers\PlatformBillingAccountAllowanceController;
use App\Domain\Billing\Http\Controllers\PlatformBillingAccountController;
use App\Domain\Billing\Http\Controllers\PlatformBillingAccountOwnerController;
use App\Domain\Billing\Http\Controllers\PlatformBillingAccountPlanController;
use App\Domain\Billing\Http\Controllers\PlatformOrganizationBillingAccountController;
use App\Domain\Billing\Http\Controllers\PlatformPlanController;
use Illuminate\Support\Facades\Route;

// Billing accounts (spec 023, ADR-026), plans and allowances (specs 028 and 029, ADR-035).
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
            Route::put('billing-accounts/{billingAccount}/plan', [PlatformBillingAccountPlanController::class, 'update'])
                ->whereUuid('billingAccount')
                ->name('billing-accounts.plan.update');
            Route::put('billing-accounts/{billingAccount}/allowances/{kind}', [PlatformBillingAccountAllowanceController::class, 'update'])
                ->whereUuid('billingAccount')
                ->whereIn('kind', AllowanceKind::values())
                ->name('billing-accounts.allowances.update');
            Route::delete('billing-accounts/{billingAccount}/allowances/{kind}', [PlatformBillingAccountAllowanceController::class, 'destroy'])
                ->whereUuid('billingAccount')
                ->whereIn('kind', AllowanceKind::values())
                ->name('billing-accounts.allowances.destroy');

            Route::get('billing-plans', [PlatformPlanController::class, 'index'])->name('billing-plans.index');
            Route::post('billing-plans', [PlatformPlanController::class, 'store'])->name('billing-plans.store');
            Route::get('billing-plans/{billingPlan}', [PlatformPlanController::class, 'show'])
                ->whereUuid('billingPlan')
                ->name('billing-plans.show');
            Route::patch('billing-plans/{billingPlan}', [PlatformPlanController::class, 'update'])
                ->whereUuid('billingPlan')
                ->name('billing-plans.update');
            Route::delete('billing-plans/{billingPlan}', [PlatformPlanController::class, 'destroy'])
                ->whereUuid('billingPlan')
                ->name('billing-plans.destroy');
            Route::post('billing-plans/{billingPlan}/archive', [PlatformPlanController::class, 'archive'])
                ->whereUuid('billingPlan')
                ->name('billing-plans.archive');
            Route::post('billing-plans/{billingPlan}/restore', [PlatformPlanController::class, 'restore'])
                ->whereUuid('billingPlan')
                ->name('billing-plans.restore');
        });

    // Owners: an account the signed-in person does not own answers 404.
    Route::get('billing-accounts', [OwnedBillingAccountController::class, 'index'])
        ->name('billing-accounts.index');
    Route::post('billing-accounts/{billingAccount}/organizations', [OwnedBillingAccountOrganizationController::class, 'store'])
        ->whereUuid('billingAccount')
        ->name('billing-accounts.organizations.store');
});
