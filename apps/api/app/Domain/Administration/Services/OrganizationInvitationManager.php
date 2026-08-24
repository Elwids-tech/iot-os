<?php

declare(strict_types=1);

namespace App\Domain\Administration\Services;

use App\Domain\Administration\Models\OrganizationInvitation;
use App\Domain\Administration\Notifications\OrganizationInvitationNotification;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class OrganizationInvitationManager
{
    public function __construct(private readonly OrganizationRoleManager $roleManager) {}

    /**
     * @param  list<int>  $roleIds
     */
    public function invite(Organization $organization, User $invitedBy, string $email, array $roleIds): OrganizationInvitation
    {
        $email = Str::lower(trim($email));

        if ($organization->users()->where('email', $email)->exists()) {
            throw ValidationException::withMessages(['email' => 'This user already belongs to the organization.']);
        }

        $roles = $this->roleManager->rolesFor($organization, $roleIds);
        $token = Str::random(64);

        $invitation = DB::transaction(function () use ($organization, $invitedBy, $email, $roles, $token): OrganizationInvitation {
            OrganizationInvitation::query()
                ->where('organization_id', $organization->getKey())
                ->where('email', $email)
                ->whereNull('accepted_at')
                ->whereNull('revoked_at')
                ->update(['revoked_at' => now()]);

            return OrganizationInvitation::query()->create([
                'uuid' => (string) Str::uuid(),
                'organization_id' => $organization->getKey(),
                'email' => $email,
                'role_ids' => $roles->modelKeys(),
                'token_hash' => hash('sha256', $token),
                'invited_by_user_id' => $invitedBy->getKey(),
                'expires_at' => now()->addDays(7),
            ]);
        });

        $invitation->load('organization');
        Notification::route('mail', $email)->notify(new OrganizationInvitationNotification($invitation, $token));

        return $invitation;
    }

    public function findPending(string $token): OrganizationInvitation
    {
        $invitation = OrganizationInvitation::query()
            ->with('organization')
            ->where('token_hash', hash('sha256', $token))
            ->first();

        if ($invitation === null || ! $invitation->isPending()) {
            abort(404, 'Invitation not found or no longer active.');
        }

        return $invitation;
    }

    public function accept(string $token, ?string $name, ?string $password): User
    {
        return DB::transaction(function () use ($token, $name, $password): User {
            $invitation = OrganizationInvitation::query()
                ->with('organization')
                ->where('token_hash', hash('sha256', $token))
                ->lockForUpdate()
                ->first();

            if ($invitation === null || ! $invitation->isPending()) {
                throw ValidationException::withMessages(['token' => 'This invitation is not active.']);
            }

            $user = User::query()->where('email', $invitation->email)->first();

            if ($user === null) {
                if ($name === null || trim($name) === '' || $password === null) {
                    throw ValidationException::withMessages([
                        'name' => 'Name is required to create your account.',
                        'password' => 'Password is required to create your account.',
                    ]);
                }

                $user = User::query()->create([
                    'name' => trim($name),
                    'email' => $invitation->email,
                    'password' => $password,
                    'email_verified_at' => now(),
                ]);
            } elseif ($user->email_verified_at === null) {
                $user->forceFill(['email_verified_at' => now()])->save();
            }

            if ($user->organizations()->whereKey($invitation->organization_id)->exists()) {
                throw ValidationException::withMessages(['token' => 'This user already belongs to the organization.']);
            }

            $user->organizations()->attach($invitation->organization_id);
            $this->roleManager->syncMemberRoles($invitation->organization, $user, $invitation->role_ids);

            $invitation->forceFill(['accepted_at' => now()])->save();

            return $user;
        });
    }
}
