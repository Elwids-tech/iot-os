<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Controllers;

use App\Domain\Administration\Http\Resources\PlatformRoleResource;
use App\Domain\Authorization\Models\Role;
use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

final class PlatformRoleController
{
    public function index(Request $request): AnonymousResourceCollection
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        $search = trim((string) $request->query('search', ''));
        $organization = trim((string) $request->query('organization', ''));
        $perPage = min(max((int) $request->query('per_page', 25), 1), 100);

        $roles = Role::query()
            ->whereNotNull('organization_id')
            ->when($search !== '', function ($query) use ($search): void {
                $query->where(function ($query) use ($search): void {
                    $query->where('display_name', 'like', "%{$search}%")
                        ->orWhere('name', 'like', "%{$search}%");
                });
            })
            ->when($organization !== '', function ($query) use ($organization): void {
                $query->whereHas('organization', fn ($query) => $query->where('uuid', $organization));
            })
            ->with('organization')
            ->withCount('permissions')
            ->orderBy('display_name')
            ->paginate($perPage)
            ->withQueryString();

        return PlatformRoleResource::collection($roles);
    }
}
