<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Controllers;

use App\Domain\Administration\Http\Requests\StoreOrganizationRequest;
use App\Domain\Administration\Http\Requests\UpdateOrganizationRequest;
use App\Domain\Administration\Services\OrganizationDefaultRoles;
use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Shared\Http\Resources\OrganizationResource;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

final class PlatformOrganizationController
{
    public function __construct(private readonly OrganizationDefaultRoles $defaultRoles) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        $search = trim((string) $request->query('search', ''));
        $perPage = min(max((int) $request->query('per_page', 25), 1), 100);

        $organizations = Organization::query()
            ->when($search !== '', function ($query) use ($search): void {
                $query->where(function ($query) use ($search): void {
                    $query->where('name', 'like', "%{$search}%")
                        ->orWhere('slug', 'like', "%{$search}%");
                });
            })
            ->withCount('users')
            // Devices block deletion (spec 006), so the directory shows how many each has.
            ->addSelect(['devices_count' => DB::table('devices')
                ->selectRaw('count(*)')
                ->whereColumn('devices.organization_id', 'organizations.id')])
            ->orderBy('name')
            ->paginate($perPage)
            ->withQueryString();

        return OrganizationResource::collection($organizations);
    }

    public function store(StoreOrganizationRequest $request): JsonResponse
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        $organization = DB::transaction(function () use ($request): Organization {
            $organization = Organization::query()->create($request->validated());
            $this->defaultRoles->ensure($organization);

            return $organization;
        });

        return OrganizationResource::make($organization)
            ->response()
            ->setStatusCode(201);
    }

    public function update(UpdateOrganizationRequest $request, Organization $organization): JsonResource
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        $organization->update($request->validated());

        return OrganizationResource::make($organization->fresh());
    }
}
