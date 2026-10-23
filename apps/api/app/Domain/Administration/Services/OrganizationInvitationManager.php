<?php

declare(strict_types=1);

namespace App\Domain\Administration\Services;

use App\Domain\Administration\Models\OrganizationInvitation;
use App\Domain\Administration\Notifications\OrganizationInvitationNotification;
use App\Domain\Administration\Notifications\OrganizationWelcomeNotification;
use App\Domain\Authorization\Models\Role;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class OrganizationInvitationManager
{
    private const LIFETIME_DAYS = 7;

    public function __construct(
        private readonly OrganizationRoleManager $roleManager,
        private readonly OrganizationGrants $grants,
        private readonly SuperAdministrators $superAdministrators,
    ) {}

    /**
     * @param  list<int>  $roleIds
     */
    public function invite(Organization $organization, User $invitedBy, string $email, array $roleIds): OrganizationInvitation
    {
        $email = Str::lower(trim($email));

        $this->ensureNotMember($organization, $email);

        $roles = $this->roleManager->rolesFor($organization, $roleIds);
        $this->grants->ensureRoles($invitedBy, $organization, $roles);
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
                'expires_at' => now()->addDays(self::LIFETIME_DAYS),
            ]);
        });

        $this->send($invitation, $token);

        return $invitation;
    }

    /**
     * Invite someone to become a super administrator: no organization, no roles (spec 007).
     * The caller has checked that the inviter is a super administrator.
     */
    public function inviteSuperAdministrator(User $invitedBy, string $email): OrganizationInvitation
    {
        $email = Str::lower(trim($email));

        if (User::query()->where('email', $email)->where('is_super_admin', true)->exists()) {
            throw ValidationException::withMessages(['email' => 'This user is already a super administrator.']);
        }

        $token = Str::random(64);

        $invitation = DB::transaction(function () use ($invitedBy, $email, $token): OrganizationInvitation {
            OrganizationInvitation::query()
                ->where('grants_super_admin', true)
                ->where('email', $email)
                ->whereNull('accepted_at')
                ->whereNull('revoked_at')
                ->update(['revoked_at' => now()]);

            return OrganizationInvitation::query()->create([
                'uuid' => (string) Str::uuid(),
                'organization_id' => null,
                'grants_super_admin' => true,
                'email' => $email,
                'role_ids' => [],
                'token_hash' => hash('sha256', $token),
                'invited_by_user_id' => $invitedBy->getKey(),
                'expires_at' => now()->addDays(self::LIFETIME_DAYS),
            ]);
        });

        $this->send($invitation, $token);

        return $invitation;
    }

    /**
     * Issue a fresh link for a pending or expired invitation; the old link stops working.
     */
    public function resend(OrganizationInvitation $invitation, User $actor): OrganizationInvitation
    {
        if ($invitation->accepted_at !== null || $invitation->revoked_at !== null) {
            throw ValidationException::withMessages(['invitation' => 'Only pending or expired invitations can be sent again.']);
        }

        $organization = $invitation->organization;
        $this->ensureNotMember($organization, $invitation->email);
        $this->grants->ensureRoles($actor, $organization, $this->roleManager->rolesFor($organization, $invitation->role_ids), 'invitation');

        $token = Str::random(64);
        $invitation->forceFill([
            'token_hash' => hash('sha256', $token),
            'expires_at' => now()->addDays(self::LIFETIME_DAYS),
        ])->save();

        $this->send($invitation, $token);

        return $invitation;
    }

    public function revoke(OrganizationInvitation $invitation, User $actor): void
    {
        if (! $invitation->isPending()) {
            throw ValidationException::withMessages(['invitation' => 'Only pending invitations can be revoked.']);
        }

        // The controller has required a super administrator; there is no organization to check grants in.
        if ($invitation->grants_super_admin) {
            $invitation->forceFill(['revoked_at' => now()])->save();

            return;
        }

        $roles = Role::query()
            ->where('organization_id', $invitation->organization_id)
            ->whereIn('id', $invitation->role_ids)
            ->get();
        $this->grants->ensureRoles($actor, $invitation->organization, $roles, 'invitation');

        $invitation->forceFill(['revoked_at' => now()])->save();
    }

    /**
     * Attach each invitation's roles for display, with one query.
     *
     * @param  Collection<int, OrganizationInvitation>  $invitations
     */
    public function loadRoles(Collection $invitations): void
    {
        $roles = Role::query()
            ->with('permissions')
            ->whereIn('id', $invitations->flatMap(fn (OrganizationInvitation $invitation) => $invitation->role_ids)->unique()->values())
            ->get()
            ->keyBy('id');

        $invitations->each(fn (OrganizationInvitation $invitation) => $invitation->setRelation(
            'roles',
            $roles->only($invitation->role_ids)->values(),
        ));
    }

    public function findPending(string $token): OrganizationInvitation
    {
        $invitation = OrganizationInvitation::query()
            ->with('organization')
            ->where('token_hash', hash('sha256', $token))
            ->first();

        if ($invitation === null || ! $this->isActive($invitation)) {
            abort(404, 'Invitation not found or no longer active.');
        }

        return $invitation;
    }

    public function accept(string $token, ?string $name, ?string $password, ?User $authenticatedUser): User
    {
        return DB::transaction(function () use ($token, $name, $password, $authenticatedUser): User {
            $invitation = OrganizationInvitation::query()
                ->with('organization')
                ->where('token_hash', hash('sha256', $token))
                ->lockForUpdate()
                ->first();

            if ($invitation === null || ! $this->isActive($invitation)) {
                throw ValidationException::withMessages(['token' => 'This invitation is not active.']);
            }

            $user = User::query()->where('email', $invitation->email)->first();

            if ($user === null) {
                if ($authenticatedUser !== null) {
                    throw ValidationException::withMessages([
                        'email' => 'Sign out before creating an account for this invitation.',
                    ]);
                }

                if ($name === null || trim($name) === '' || $password === null) {
                    throw ValidationException::withMessages([
                        'name' => 'Name is required to create your account.',
                        'password' => 'Password is required to create your account.',
                    ]);
                }

                // Following the emailed link proves the address. email_verified_at is not fillable,
                // so create() would drop it and leave the account unverified for good.
                $user = User::query()->forceCreate([
                    'name' => trim($name),
                    'email' => $invitation->email,
                    'password' => $password,
                    'email_verified_at' => now(),
                ]);
            } elseif ($authenticatedUser === null || ! hash_equals($user->email, Str::lower($authenticatedUser->email))) {
                throw ValidationException::withMessages([
                    'email' => 'Sign in with the invited email address before accepting this invitation.',
                ]);
            } elseif ($user->email_verified_at === null) {
                $user->forceFill(['email_verified_at' => now()])->save();
            }

            if ($invitation->grants_super_admin) {
                $this->superAdministrators->promote($user, $invitation->invited_by_user_id, [
                    'invitation_uuid' => $invitation->uuid,
                ]);
            } else {
                if ($user->organizations()->whereKey($invitation->organization_id)->exists()) {
                    throw ValidationException::withMessages(['token' => 'This user already belongs to the organization.']);
                }

                $user->organizations()->attach($invitation->organization_id);
                $this->roleManager->syncMemberRoles($invitation->organization, $user, $invitation->role_ids);
                $user->notify(new OrganizationWelcomeNotification($invitation->organization));
            }

            $invitation->forceFill(['accepted_at' => now()])->save();

            return $user;
        });
    }

    /**
     * Pending, and for a super-administrator invitation, still backed by a super administrator:
     * removing someone's access voids the invitations they sent.
     */
    private function isActive(OrganizationInvitation $invitation): bool
    {
        if (! $invitation->isPending()) {
            return false;
        }

        return ! $invitation->grants_super_admin
            || User::query()->whereKey($invitation->invited_by_user_id)->where('is_super_admin', true)->exists();
    }

    private function ensureNotMember(Organization $organization, string $email): void
    {
        if ($organization->users()->where('email', $email)->exists()) {
            throw ValidationException::withMessages(['email' => 'This user already belongs to the organization.']);
        }
    }

    private function send(OrganizationInvitation $invitation, string $token): void
    {
        $invitation->load('organization');
        Notification::route('mail', $invitation->email)->notify(new OrganizationInvitationNotification($invitation, $token));
    }
}
