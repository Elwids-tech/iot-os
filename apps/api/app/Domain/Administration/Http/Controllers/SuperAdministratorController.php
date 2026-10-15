<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Controllers;

use App\Domain\Administration\Http\Resources\PlatformUserResource;
use App\Domain\Administration\Services\SuperAdministrators;
use App\Domain\Shared\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Http\Response;

/**
 * Super administrators grant and remove super administrator access (spec 007).
 */
final class SuperAdministratorController
{
    public function __construct(private readonly SuperAdministrators $superAdministrators) {}

    public function update(Request $request, User $user): JsonResource
    {
        $this->superAdministrators->grant($this->actor($request), $user);

        return PlatformUserResource::make($user->fresh([
            'organizations' => fn ($query) => $query->orderBy('name'),
            'platformRoles' => fn ($query) => $query->orderBy('display_name'),
        ]));
    }

    public function destroy(Request $request, User $user): Response
    {
        $this->superAdministrators->revoke($this->actor($request), $user);

        return response()->noContent();
    }

    private function actor(Request $request): User
    {
        /** @var User $user */
        $user = $request->user();

        abort_unless($user->is_super_admin, 403);

        return $user;
    }
}
