<?php

declare(strict_types=1);

namespace App\Domain\Authorization\Http\Middleware;

use App\Domain\Branding\Exceptions\BrandingRefusal;
use App\Domain\Branding\Services\PortalAccess;
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

        // On a billing account's address only its organizations exist (spec 036, FR-021),
        // for members of others and for super administrators alike.
        if (! app(PortalAccess::class)->reaches($organization, $request)) {
            throw new BrandingRefusal(404, PortalAccess::CODE, 'This organization is not available at this address.');
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
        // A long-lived request user can retain role relations loaded under a
        // previous tenant. Resolve them again after setting the active team.
        $request->user()->unsetRelation('roles')->unsetRelation('permissions');
        $request->attributes->set('organization', $organization);

        try {
            return $next($request);
        } finally {
            $permissionRegistrar->setPermissionsTeamId($previousTeamId);
            $request->user()->unsetRelation('roles')->unsetRelation('permissions');
        }
    }
}
