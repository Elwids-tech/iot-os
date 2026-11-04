<?php

declare(strict_types=1);

namespace App\Domain\Firmware\Http\Controllers;

use App\Domain\DeviceProfiles\Services\DeviceProfileAuthorization;
use App\Domain\Firmware\Services\TargetRegistry;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;

final class FirmwareTargetController
{
    public function index(Request $request, Organization $organization, DeviceProfileAuthorization $authorization, TargetRegistry $registry): array
    {
        abort_unless($authorization->capabilities($request->user(), $organization)['view_any'], 403);

        return ['data' => array_map(TargetRegistry::view(...), $registry->available())];
    }
}
