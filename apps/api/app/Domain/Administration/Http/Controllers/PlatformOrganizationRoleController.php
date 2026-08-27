<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Controllers;

use App\Domain\Administration\Http\Resources\PlatformRoleResource;
use App\Domain\Authorization\Models\Role;
use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

final class PlatformOrganizationRoleController
{
    public function index(Request $request, Organization $organization): AnonymousResourceCollection
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        $roles = Role::query()
            ->where('organization_id', $organization->getKey())
            ->with('organization')
            ->withCount('permissions')
            ->orderBy('display_name')
            ->get();

        return PlatformRoleResource::collection($roles);
    }
}
