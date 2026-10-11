<?php

declare(strict_types=1);

use App\Domain\Authorization\Http\Middleware\ResolveOrganizationContext;
use App\Domain\Overview\OverviewController;
use Illuminate\Support\Facades\Route;

Route::get('v1/organizations/{organization}/overview', OverviewController::class)->whereUuid('organization')->middleware(['auth:sanctum', ResolveOrganizationContext::class]);
