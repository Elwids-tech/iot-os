<?php

declare(strict_types=1);

namespace App\Domain\Authorization\Http\Middleware;

use App\Domain\Shared\Models\Organization;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Spatie\Permission\PermissionRegistrar;
use Symfony\Component\HttpFoundation\Response;

final class ResolveOrganizationHeaderContext
{
    public function handle(Request $request, Closure $next): Response
    {
        $organizationUuid = $request->header('X-Organization-UUID');
        abort_unless(
            is_string($organizationUuid) && Str::isUuid($organizationUuid),
            400,
            'A valid X-Organization-UUID header is required.',
        );

        $organization = Organization::query()->where('uuid', $organizationUuid)->firstOrFail();
        $user = $request->user();
        abort_if($user === null, 401);
        abort_unless(
            $user->is_super_admin || $user->organizations()->whereKey($organization->getKey())->exists(),
            403,
            'You do not belong to this organization.',
        );

        $permissionRegistrar = app(PermissionRegistrar::class);
        $previousTeamId = $permissionRegistrar->getPermissionsTeamId();
        $permissionRegistrar->setPermissionsTeamId($organization->getKey());
        $request->attributes->set('organization', $organization);

        try {
            return $next($request);
        } finally {
            $permissionRegistrar->setPermissionsTeamId($previousTeamId);
        }
    }
}
