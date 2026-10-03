<?php

declare(strict_types=1);

namespace App\Domain\Automation\Services;

use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\PermissionRegistrar;

final class DagAuthorization
{
    public function authorize(User $user, Organization $org, string $permission, ?Model $resource = null): void
    {
        if ($resource) {
            abort_unless($resource->organization_id === $org->id, 404);
        }
        abort_unless($user->is_super_admin || $user->organizations()->whereKey($org->id)->exists(), 403);
        $r = app(PermissionRegistrar::class);
        $old = $r->getPermissionsTeamId();
        $r->setPermissionsTeamId($org->id);
        $user->unsetRelation('roles')->unsetRelation('permissions');
        try {
            abort_unless($user->is_super_admin || $user->checkPermissionTo('Workflow.'.$permission), 403);
        } finally {
            $r->setPermissionsTeamId($old);
            $user->unsetRelation('roles')->unsetRelation('permissions');
        }
    }

    public function enabled(Organization $org): void
    {
        abort_unless(DB::table('automation_settings')->where('organization_id', $org->id)->where('enabled', true)->exists(), 403, 'DAG automation is not enabled for this organization.');
    }
}
