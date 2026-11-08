<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Controllers;

use App\Domain\Administration\Http\Resources\IntegrationStreamSessionResource;
use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Integrations\Models\IntegrationStreamSession;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

/**
 * The open application telemetry streams of one organization (spec 030, US6), for
 * platform administrators: who is streaming, since when, how many devices, and the
 * last position relayed.
 */
final class PlatformOrganizationStreamController
{
    public function index(Organization $organization): AnonymousResourceCollection
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        $sessions = IntegrationStreamSession::query()->open()
            ->where('organization_id', $organization->getKey())
            ->with('application:id,uuid,name')
            ->orderBy('opened_at')
            ->get();

        return IntegrationStreamSessionResource::collection($sessions);
    }
}
