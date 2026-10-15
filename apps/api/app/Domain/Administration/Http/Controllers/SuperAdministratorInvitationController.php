<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Controllers;

use App\Domain\Administration\Http\Requests\StoreSuperAdministratorInvitationRequest;
use App\Domain\Administration\Http\Resources\OrganizationInvitationResource;
use App\Domain\Administration\Services\OrganizationInvitationManager;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;

/**
 * Super administrators invite someone to become a super administrator (spec 007).
 */
final class SuperAdministratorInvitationController
{
    public function __construct(private readonly OrganizationInvitationManager $invitations) {}

    public function store(StoreSuperAdministratorInvitationRequest $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();

        abort_unless($user->is_super_admin, 403);

        /** @var array{email: string} $validated */
        $validated = $request->validated();
        $invitation = $this->invitations->inviteSuperAdministrator($user, $validated['email']);
        $invitation->setRelation('organization', null);
        $invitation->setRelation('roles', collect());

        return OrganizationInvitationResource::make($invitation)
            ->response()
            ->setStatusCode(201);
    }
}
