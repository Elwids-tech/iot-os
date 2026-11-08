<?php

declare(strict_types=1);

use App\Domain\Authorization\Http\Middleware\ResolveOrganizationContext;
use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Enums\PriceKind;
use App\Domain\Billing\Http\Controllers\OrganizationUsageController;
use App\Domain\Billing\Http\Controllers\OwnedBillingAccountController;
use App\Domain\Billing\Http\Controllers\OwnedBillingAccountOrganizationController;
use App\Domain\Billing\Http\Controllers\OwnedBillingAccountUsageController;
use App\Domain\Billing\Http\Controllers\OwnedInvoiceController;
use App\Domain\Billing\Http\Controllers\PlatformBillingAccountAllowanceController;
use App\Domain\Billing\Http\Controllers\PlatformBillingAccountController;
use App\Domain\Billing\Http\Controllers\PlatformBillingAccountOwnerController;
use App\Domain\Billing\Http\Controllers\PlatformBillingAccountPlanController;
use App\Domain\Billing\Http\Controllers\PlatformBillingAccountPriceController;
use App\Domain\Billing\Http\Controllers\PlatformBillingAccountUsageController;
use App\Domain\Billing\Http\Controllers\PlatformBillingSettingsController;
use App\Domain\Billing\Http\Controllers\PlatformInvoiceController;
use App\Domain\Billing\Http\Controllers\PlatformOrganizationBillingAccountController;
use App\Domain\Billing\Http\Controllers\PlatformPlanController;
use App\Domain\Billing\Http\Controllers\PlatformTaxRateController;
use Illuminate\Support\Facades\Route;

// Billing accounts (spec 023, ADR-026), plans, allowances and usage (specs 028 and 029, ADR-035),
// prices, tax and invoices (spec 029 US6).
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
            Route::get('billing-accounts/{billingAccount}/usage', [PlatformBillingAccountUsageController::class, 'show'])
                ->whereUuid('billingAccount')
                ->name('billing-accounts.usage.show');
            Route::put('billing-accounts/{billingAccount}/prices/{price}', [PlatformBillingAccountPriceController::class, 'update'])
                ->whereUuid('billingAccount')
                ->whereIn('price', PriceKind::values())
                ->name('billing-accounts.prices.update');
            Route::patch('billing-accounts/{billingAccount}/billing-details', [PlatformBillingAccountPriceController::class, 'details'])
                ->whereUuid('billingAccount')
                ->name('billing-accounts.billing-details.update');
            Route::post('billing-accounts/{billingAccount}/invoices', [PlatformInvoiceController::class, 'store'])
                ->whereUuid('billingAccount')
                ->name('billing-accounts.invoices.store');

            Route::get('billing/settings', [PlatformBillingSettingsController::class, 'show'])->name('billing.settings.show');
            Route::put('billing/settings', [PlatformBillingSettingsController::class, 'update'])->name('billing.settings.update');
            Route::get('billing/tax-rates', [PlatformTaxRateController::class, 'index'])->name('billing.tax-rates.index');
            Route::post('billing/tax-rates', [PlatformTaxRateController::class, 'store'])->name('billing.tax-rates.store');
            Route::patch('billing/tax-rates/{taxRate}', [PlatformTaxRateController::class, 'update'])
                ->whereUuid('taxRate')
                ->name('billing.tax-rates.update');
            Route::post('billing/tax-rates/{taxRate}/archive', [PlatformTaxRateController::class, 'archive'])
                ->whereUuid('taxRate')
                ->name('billing.tax-rates.archive');

            Route::get('billing/invoices', [PlatformInvoiceController::class, 'index'])->name('billing.invoices.index');
            Route::get('billing/invoices/waiting', [PlatformInvoiceController::class, 'waiting'])->name('billing.invoices.waiting');
            Route::get('billing/invoices/{invoice}.pdf', [PlatformInvoiceController::class, 'pdf'])
                ->whereUuid('invoice')
                ->name('billing.invoices.pdf');
            Route::get('billing/invoices/{invoice}.csv', [PlatformInvoiceController::class, 'csv'])
                ->whereUuid('invoice')
                ->name('billing.invoices.csv');
            Route::get('billing/invoices/{invoice}', [PlatformInvoiceController::class, 'show'])
                ->whereUuid('invoice')
                ->name('billing.invoices.show');
            Route::post('billing/invoices/{invoice}/recalculate', [PlatformInvoiceController::class, 'recalculate'])
                ->whereUuid('invoice')
                ->name('billing.invoices.recalculate');
            Route::post('billing/invoices/{invoice}/adjustments', [PlatformInvoiceController::class, 'addAdjustment'])
                ->whereUuid('invoice')
                ->name('billing.invoices.adjustments.store');
            Route::delete('billing/invoices/{invoice}/adjustments/{line}', [PlatformInvoiceController::class, 'removeAdjustment'])
                ->whereUuid('invoice')
                ->whereNumber('line')
                ->name('billing.invoices.adjustments.destroy');
            Route::post('billing/invoices/{invoice}/issue', [PlatformInvoiceController::class, 'issue'])
                ->whereUuid('invoice')
                ->name('billing.invoices.issue');
            Route::post('billing/invoices/{invoice}/credit-notes', [PlatformInvoiceController::class, 'creditNote'])
                ->whereUuid('invoice')
                ->name('billing.invoices.credit-notes.store');
            Route::get('billing/credit-notes/{creditNote}.pdf', [PlatformInvoiceController::class, 'creditNotePdf'])
                ->whereUuid('creditNote')
                ->name('billing.credit-notes.pdf');

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
            Route::put('billing-plans/{billingPlan}/prices', [PlatformPlanController::class, 'prices'])
                ->whereUuid('billingPlan')
                ->name('billing-plans.prices.update');
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
    Route::get('billing-accounts/{billingAccount}/usage', [OwnedBillingAccountUsageController::class, 'show'])
        ->whereUuid('billingAccount')
        ->name('billing-accounts.usage.show');
    // Issued invoices and credit notes only; a draft answers 404 (spec 029 FR-036).
    Route::get('billing-accounts/{billingAccount}/invoices', [OwnedInvoiceController::class, 'index'])
        ->whereUuid('billingAccount')
        ->name('billing-accounts.invoices.index');
    Route::get('billing-accounts/{billingAccount}/invoices/{invoice}.pdf', [OwnedInvoiceController::class, 'pdf'])
        ->whereUuid(['billingAccount', 'invoice'])
        ->name('billing-accounts.invoices.pdf');
    Route::get('billing-accounts/{billingAccount}/invoices/{invoice}.csv', [OwnedInvoiceController::class, 'csv'])
        ->whereUuid(['billingAccount', 'invoice'])
        ->name('billing-accounts.invoices.csv');
    Route::get('billing-accounts/{billingAccount}/invoices/{invoice}', [OwnedInvoiceController::class, 'show'])
        ->whereUuid(['billingAccount', 'invoice'])
        ->name('billing-accounts.invoices.show');
    Route::get('billing-accounts/{billingAccount}/credit-notes/{creditNote}.pdf', [OwnedInvoiceController::class, 'creditNotePdf'])
        ->whereUuid(['billingAccount', 'creditNote'])
        ->name('billing-accounts.credit-notes.pdf');
});

// Managers: their organization's usage, needing Device.manage (spec 028 FR-022, spec 029 FR-024).
Route::prefix('v1/organizations/{organization}')->name('api.v1.organizations.')
    ->whereUuid('organization')
    ->middleware(['auth:sanctum', ResolveOrganizationContext::class])
    ->group(function (): void {
        Route::get('usage', [OrganizationUsageController::class, 'show'])->name('usage.show');
    });
