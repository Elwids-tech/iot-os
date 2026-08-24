<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Controllers;

use App\Domain\Administration\Http\Requests\StoreOrganizationInvitationRequest;
use App\Domain\Administration\Http\Resources\OrganizationInvitationResource;
use App\Domain\Administration\Models\OrganizationInvitation;
use App\Domain\Administration\Services\OrganizationAdministrationAuthorization;
use App\Domain\Administration\Services\OrganizationInvitationManager;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use App\Domain\Shared\Permissions\UserPermission;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

final class OrganizationInvitationController
{
    public function __construct(
        private readonly OrganizationAdministrationAuthorization $authorization,
        private readonly OrganizationInvitationManager $invitations,
    ) {}

    public function index(Request $request, Organization $organization): AnonymousResourceCollection
    {
        $this->authorize($request, $organization, UserPermission::VIEW_ANY->value);

        return OrganizationInvitationResource::collection(
            OrganizationInvitation::query()
                ->where('organization_id', $organization->getKey())
                ->latest()
                ->paginate(min(max((int) $request->query('per_page', 25), 1), 100))
                ->withQueryString(),
        );
    }

    public function store(StoreOrganizationInvitationRequest $request, Organization $organization): JsonResponse
    {
        $this->authorize($request, $organization, UserPermission::CREATE->value);

        /** @var User $user */
        $user = $request->user();
        /** @var array{email: string, role_ids: list<int>} $validated */
        $validated = $request->validated();

        return OrganizationInvitationResource::make(
            $this->invitations->invite($organization, $user, $validated['email'], $validated['role_ids']),
        )->response()->setStatusCode(201);
    }

    public function destroy(
        Request $request,
        Organization $organization,
        OrganizationInvitation $invitation,
    ): Response {
        $this->authorize($request, $organization, UserPermission::DELETE->value);
        abort_unless($invitation->organization_id === $organization->getKey(), 404);
        abort_if($invitation->accepted_at !== null, 422, 'Accepted invitations cannot be revoked.');

        $invitation->forceFill(['revoked_at' => now()])->save();

        return response()->noContent();
    }

    private function authorize(Request $request, Organization $organization, string $permission): void
    {
        /** @var User $user */
        $user = $request->user();

        abort_unless($this->authorization->allows($user, $organization, $permission), 403);
    }
}
