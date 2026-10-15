<?php

declare(strict_types=1);

namespace App\Domain\Administration\Services;

use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Grants and removes super administrator access (spec 007). This manages the flag; it is
 * not an authorization bypass. Only super administrators act here, and the actor can
 * never remove their own access, so at least one always remains.
 */
final class SuperAdministrators
{
    public function grant(User $actor, User $user): void
    {
        DB::transaction(function () use ($actor, $user): void {
            $this->lockAsActor($actor);
            $this->promote($user, $actor->getKey());
        });
    }

    public function revoke(User $actor, User $user): void
    {
        if ($actor->is($user)) {
            throw ValidationException::withMessages(['user' => 'You cannot remove your own super administrator access.']);
        }

        DB::transaction(function () use ($actor, $user): void {
            $this->lockAsActor($actor);
            $user->refresh();

            if (! $user->is_super_admin) {
                return;
            }

            $user->forceFill(['is_super_admin' => false])->save();
            $this->record('user.super_admin_revoked', $user, $actor->getKey());
        });
    }

    /**
     * Make the user a super administrator; a no-op (and no audit event) when they already are.
     *
     * @param  array<string, mixed>  $details
     */
    public function promote(User $user, ?int $actorId, array $details = []): void
    {
        DB::transaction(function () use ($user, $actorId, $details): void {
            User::query()->whereKey($user->getKey())->lockForUpdate()->first();
            $user->refresh();

            if ($user->is_super_admin) {
                return;
            }

            $user->forceFill(['is_super_admin' => true])->save();
            $this->record('user.super_admin_granted', $user, $actorId, $details);
        });
    }

    /**
     * Lock every super administrator in id order, then require the actor to be one.
     * Two super administrators removing each other serialize here: the second finds
     * its actor already removed.
     */
    private function lockAsActor(User $actor): void
    {
        $ids = User::query()
            ->where('is_super_admin', true)
            ->orderBy('id')
            ->lockForUpdate()
            ->pluck('id');

        abort_unless($ids->contains($actor->getKey()), 403);
    }

    /**
     * @param  array<string, mixed>  $details
     */
    private function record(string $action, User $user, ?int $actorId, array $details = []): void
    {
        DeviceAudit::record($action, null, $actorId, null, [
            'user_id' => $user->getKey(),
            'email' => $user->email,
            ...$details,
        ]);
    }
}
