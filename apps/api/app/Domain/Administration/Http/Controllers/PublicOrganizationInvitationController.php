<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Controllers;

use App\Domain\Administration\Http\Requests\AcceptOrganizationInvitationRequest;
use App\Domain\Administration\Services\OrganizationInvitationManager;
use App\Domain\Authentication\Http\Resources\AuthenticatedUserResource;
use App\Domain\Branding\Services\PortalAccess;
use App\Domain\Shared\Models\User;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Auth;

final class PublicOrganizationInvitationController
{
    public function __construct(
        private readonly OrganizationInvitationManager $invitations,
        private readonly PortalAccess $access,
    ) {}

    public function show(string $token): JsonResource
    {
        $invitation = $this->invitations->findPending($token);

        return new JsonResource([
            'grants_super_admin' => $invitation->grants_super_admin,
            'organization' => $invitation->organization === null ? null : [
                'uuid' => $invitation->organization->uuid,
                'name' => $invitation->organization->name,
            ],
            'email' => $invitation->email,
            'expires_at' => $invitation->expires_at,
            'acceptance_mode' => User::query()->where('email', $invitation->email)->exists()
                ? 'sign_in'
                : 'create_account',
        ]);
    }

    public function accept(AcceptOrganizationInvitationRequest $request, string $token): JsonResource
    {
        /** @var array{name?: string, password?: string} $validated */
        $validated = $request->validated();
        $authenticatedUser = $request->user();

        // On a billing account's address an invitation is accepted only into that
        // account's organizations (spec 036, FR-020); it stays pending for the right
        // address. Elsewhere nothing is looked up here, so every answer is as before.
        if ($this->access->address($request) !== null) {
            $organization = $this->invitations->findPending($token)->organization;
            if ($organization === null || ! $this->access->reaches($organization, $request)) {
                $this->access->refuse();
            }
        }

        $user = $this->invitations->accept(
            $token,
            $validated['name'] ?? null,
            $validated['password'] ?? null,
            $authenticatedUser instanceof User ? $authenticatedUser : null,
        );

        Auth::guard('web')->login($user);

        if ($request->hasSession()) {
            $request->session()->regenerate();
        }

        return AuthenticatedUserResource::make($user->fresh('organizations'));
    }
}
