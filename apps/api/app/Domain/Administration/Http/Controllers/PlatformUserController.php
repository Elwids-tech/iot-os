<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Controllers;

use App\Domain\Administration\Http\Resources\PlatformUserResource;
use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Shared\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

final class PlatformUserController
{
    public function index(Request $request): AnonymousResourceCollection
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        $search = trim((string) $request->query('search', ''));
        $organization = trim((string) $request->query('organization', ''));
        $perPage = min(max((int) $request->query('per_page', 25), 1), 100);

        $users = User::query()
            ->when($search !== '', function ($query) use ($search): void {
                $query->where(function ($query) use ($search): void {
                    $query->where('name', 'like', "%{$search}%")
                        ->orWhere('email', 'like', "%{$search}%");
                });
            })
            ->when($organization !== '', function ($query) use ($organization): void {
                $query->whereHas('organizations', fn ($query) => $query->where('uuid', $organization));
            })
            ->with([
                'organizations' => fn ($query) => $query->orderBy('name'),
                'platformRoles' => fn ($query) => $query->orderBy('display_name'),
            ])
            ->orderBy('name')
            ->paginate($perPage)
            ->withQueryString();

        return PlatformUserResource::collection($users);
    }
}
