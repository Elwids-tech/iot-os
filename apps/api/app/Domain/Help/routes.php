<?php

use App\Domain\Authorization\Http\Middleware\ResolveOrganizationContext;
use App\Domain\Help\Http\HelpController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1/organizations/{organization}/help')->whereUuid('organization')->middleware(['auth:sanctum', ResolveOrganizationContext::class])->group(function (): void {
    Route::get('page', [HelpController::class, 'page']);
    Route::get('articles', [HelpController::class, 'index']);
    Route::get('articles/{slug}', [HelpController::class, 'show'])->where('slug', '[a-z][a-z0-9-]*');
});
