<?php

declare(strict_types=1);

use App\Domain\Authorization\Http\Middleware\ResolveOrganizationContext;
use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Branding\Http\Controllers\BrandAssetController;
use App\Domain\Branding\Http\Controllers\OrganizationLogoController;
use App\Domain\Branding\Http\Controllers\OwnedBrandController;
use App\Domain\Branding\Http\Controllers\PlatformBrandController;
use App\Domain\Branding\Models\BrandAsset;
use Illuminate\Support\Facades\Route;

// Brands and logos (spec 036, ADR-050, specs/036-white-label-custom-domains/contracts/branding-api.md).
// Images are uploaded with POST: PHP reads a multipart body only on POST.
Route::prefix('v1')->name('api.v1.')->group(function (): void {
    // Public: the sign-in page shows a brand before anyone signs in.
    Route::get('brand-assets/{asset}/{variant}', [BrandAssetController::class, 'show'])
        ->where('asset', '[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}[0-9a-f]{'.BrandAsset::HASH_LENGTH.'}')
        ->where('variant', '[a-z0-9]{1,16}')
        ->name('brand-assets.show');

    Route::middleware('auth:sanctum')->group(function (): void {
        Route::prefix('admin')->name('admin.')
            ->middleware('can:'.PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value)
            ->group(function (): void {
                Route::get('billing-accounts/{billingAccount}/branding', [PlatformBrandController::class, 'show'])
                    ->whereUuid('billingAccount')
                    ->name('billing-accounts.branding.show');
                Route::put('billing-accounts/{billingAccount}/brand', [PlatformBrandController::class, 'update'])
                    ->whereUuid('billingAccount')
                    ->name('billing-accounts.brand.update');
                Route::post('billing-accounts/{billingAccount}/brand/images/{role}', [PlatformBrandController::class, 'storeImage'])
                    ->whereUuid('billingAccount')
                    ->whereIn('role', BrandAsset::ROLES)
                    ->middleware('throttle:30,1')
                    ->name('billing-accounts.brand.images.store');
                Route::delete('billing-accounts/{billingAccount}/brand/images/{role}', [PlatformBrandController::class, 'destroyImage'])
                    ->whereUuid('billingAccount')
                    ->whereIn('role', BrandAsset::ROLES)
                    ->name('billing-accounts.brand.images.destroy');
            });

        // Owners: an account the signed-in person does not own answers 404.
        Route::get('billing-accounts/{billingAccount}/branding', [OwnedBrandController::class, 'show'])
            ->whereUuid('billingAccount')
            ->name('billing-accounts.branding.show');
        Route::put('billing-accounts/{billingAccount}/brand', [OwnedBrandController::class, 'update'])
            ->whereUuid('billingAccount')
            ->name('billing-accounts.brand.update');
        Route::post('billing-accounts/{billingAccount}/brand/images/{role}', [OwnedBrandController::class, 'storeImage'])
            ->whereUuid('billingAccount')
            ->whereIn('role', BrandAsset::ROLES)
            ->middleware('throttle:30,1')
            ->name('billing-accounts.brand.images.store');
        Route::delete('billing-accounts/{billingAccount}/brand/images/{role}', [OwnedBrandController::class, 'destroyImage'])
            ->whereUuid('billingAccount')
            ->whereIn('role', BrandAsset::ROLES)
            ->name('billing-accounts.brand.images.destroy');
    });
});

// An organization's own logo, needing Organization.update (spec 036 US2).
Route::prefix('v1/organizations/{organization}')->name('api.v1.organizations.')
    ->whereUuid('organization')
    ->middleware(['auth:sanctum', ResolveOrganizationContext::class])
    ->group(function (): void {
        Route::post('logo', [OrganizationLogoController::class, 'store'])->middleware('throttle:30,1')->name('logo.store');
        Route::delete('logo', [OrganizationLogoController::class, 'destroy'])->name('logo.destroy');
        Route::post('logo/dark', [OrganizationLogoController::class, 'storeDark'])->middleware('throttle:30,1')->name('logo.dark.store');
        Route::delete('logo/dark', [OrganizationLogoController::class, 'destroyDark'])->name('logo.dark.destroy');
    });
