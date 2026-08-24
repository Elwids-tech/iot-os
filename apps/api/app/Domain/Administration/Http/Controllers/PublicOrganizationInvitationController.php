<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Controllers;

use App\Domain\Administration\Http\Requests\AcceptOrganizationInvitationRequest;
use App\Domain\Administration\Services\OrganizationInvitationManager;
use App\Domain\Authentication\Http\Resources\AuthenticatedUserResource;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Auth;

final class PublicOrganizationInvitationController
{
    public function __construct(private readonly OrganizationInvitationManager $invitations) {}

    public function show(string $token): JsonResource
    {
        $invitation = $this->invitations->findPending($token);

        return new JsonResource([
            'organization' => [
                'uuid' => $invitation->organization->uuid,
                'name' => $invitation->organization->name,
            ],
            'email' => $invitation->email,
            'expires_at' => $invitation->expires_at,
        ]);
    }

    public function accept(AcceptOrganizationInvitationRequest $request, string $token): JsonResource
    {
        /** @var array{name?: string, password?: string} $validated */
        $validated = $request->validated();
        $user = $this->invitations->accept($token, $validated['name'] ?? null, $validated['password'] ?? null);

        if ($request->hasSession()) {
            Auth::guard('web')->login($user);
            $request->session()->regenerate();
        }

        return AuthenticatedUserResource::make($user->fresh('organizations'));
    }
}
