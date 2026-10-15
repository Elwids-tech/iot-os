<?php

declare(strict_types=1);

namespace App\Domain\Administration\Services;

use App\Domain\Authorization\Enums\PlatformRoleName;
use App\Domain\Authorization\Models\PlatformRole;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Grants and removes the platform-administrator platform role (spec 008). Only super
 * administrators act here; every change is audited.
 */
final class PlatformAdministrators
{
    public function grant(User $actor, User $user): void
    {
        $this->change($actor, $user, true);
    }

    public function revoke(User $actor, User $user): void
    {
        $this->change($actor, $user, false);
    }

    private function change(User $actor, User $user, bool $grant): void
    {
        DB::transaction(function () use ($actor, $user, $grant): void {
            // Lock in id order, as SuperAdministrators locks every super administrator, so a
            // change racing the removal of its actor's access serializes with it instead of
            // deadlocking, and two changes to the same user cannot both record an event.
            $locked = User::query()
                ->whereKey([$actor->getKey(), $user->getKey()])
                ->orderBy('id')
                ->lockForUpdate()
                ->get()
                ->keyBy('id');

            abort_unless((bool) $locked->get($actor->getKey())?->is_super_admin, 403);

            $role = PlatformRole::query()
                ->where('key', PlatformRoleName::PLATFORM_ADMINISTRATOR->value)
                ->firstOrFail();

            if ($user->platformRoles()->whereKey($role->getKey())->exists() === $grant) {
                return;
            }

            if ($grant) {
                $user->platformRoles()->attach($role->getKey());
            } else {
                $user->platformRoles()->detach($role->getKey());
            }

            DeviceAudit::record(
                $grant ? 'user.platform_administrator_granted' : 'user.platform_administrator_revoked',
                null,
                $actor->getKey(),
                null,
                ['user_id' => $user->getKey(), 'email' => $user->email],
            );
        });
    }
}
