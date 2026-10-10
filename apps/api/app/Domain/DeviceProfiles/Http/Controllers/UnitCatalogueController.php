<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Http\Controllers;

use App\Domain\DeviceProfiles\Services\UnitCatalogue;
use Illuminate\Http\JsonResponse;

final class UnitCatalogueController
{
    public function __invoke(UnitCatalogue $catalogue): JsonResponse
    {
        return response()->json(['data' => $catalogue->all()])->header('Cache-Control', 'private, max-age=3600');
    }
}
