<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Controllers;

use App\Domain\Administration\Http\Requests\SyncPlatformUserRoleRequest;
use App\Domain\Administration\Http\Resources\PlatformTeamMemberResource;
use App\Domain\Authorization\Enums\PlatformRoleName;
use App\Domain\Authorization\Models\PlatformRole;
use App\Domain\Shared\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Resources\Json\JsonResource;

final class PlatformTeamController
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $this->authorize($request);
        $search = trim((string) $request->query('search', ''));

        return PlatformTeamMemberResource::collection(
            User::query()
                ->when($search !== '', function ($query) use ($search): void {
                    $query->where(function ($query) use ($search): void {
                        $query->where('name', 'like', "%{$search}%")
                            ->orWhere('email', 'like', "%{$search}%");
                    });
                })
                ->with('platformRoles')
                ->orderBy('name')
                ->paginate(min(max((int) $request->query('per_page', 25), 1), 100))
                ->withQueryString(),
        );
    }

    public function update(SyncPlatformUserRoleRequest $request, User $user): JsonResource
    {
        $this->authorize($request);
        $platformAdministrator = PlatformRole::query()
            ->where('key', PlatformRoleName::PLATFORM_ADMINISTRATOR->value)
            ->firstOrFail();

        if ($request->boolean('is_platform_administrator')) {
            $user->platformRoles()->syncWithoutDetaching([$platformAdministrator->getKey()]);
        } else {
            $user->platformRoles()->detach($platformAdministrator->getKey());
        }

        return PlatformTeamMemberResource::make($user->fresh('platformRoles'));
    }

    private function authorize(Request $request): void
    {
        /** @var User $user */
        $user = $request->user();

        abort_unless($user->is_super_admin, 403);
    }
}
