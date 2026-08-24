<?php

declare(strict_types=1);

namespace App\Domain\Authorization\Http\Middleware;

use App\Domain\Shared\Models\Organization;
use Closure;
use Illuminate\Http\Request;
use Spatie\Permission\PermissionRegistrar;
use Symfony\Component\HttpFoundation\Response;

final class ResolveOrganizationContext
{
    public function handle(Request $request, Closure $next): Response
    {
        $organization = $request->route('organization');

        if (! $organization instanceof Organization) {
            abort(404, 'Organization not found.');
        }

        abort_unless(
            $request->user()->is_super_admin
                || $request->user()->organizations()->whereKey($organization->getKey())->exists(),
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
