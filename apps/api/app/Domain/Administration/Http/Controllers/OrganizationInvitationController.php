<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Controllers;

use App\Domain\Administration\Http\Requests\StoreOrganizationInvitationRequest;
use App\Domain\Administration\Http\Resources\OrganizationInvitationResource;
use App\Domain\Administration\Models\OrganizationInvitation;
use App\Domain\Administration\Services\OrganizationAdministrationAuthorization;
use App\Domain\Administration\Services\OrganizationGrants;
use App\Domain\Administration\Services\OrganizationInvitationManager;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use App\Domain\Shared\Permissions\UserPermission;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;

final class OrganizationInvitationController
{
    public function __construct(
        private readonly OrganizationAdministrationAuthorization $authorization,
        private readonly OrganizationInvitationManager $invitations,
        private readonly OrganizationGrants $grants,
    ) {}

    /**
     * Open invitations: pending by default, or expired ones that can be sent again.
     */
    public function index(Request $request, Organization $organization): AnonymousResourceCollection
    {
        $actor = $this->authorize($request, $organization, UserPermission::VIEW_ANY->value);
        $status = $request->validate([
            'status' => ['sometimes', Rule::in(['pending', 'expired'])],
        ])['status'] ?? 'pending';

        $invitations = OrganizationInvitation::query()
            ->with('invitedBy:id,name')
            ->where('organization_id', $organization->getKey())
            ->whereNull('accepted_at')
            ->whereNull('revoked_at')
            ->where('expires_at', $status === 'pending' ? '>' : '<=', now())
            ->latest()
            ->paginate(min(max((int) $request->query('per_page', 25), 1), 100))
            ->withQueryString();

        $this->invitations->loadRoles($invitations->getCollection());
        $grantable = $this->grants->grantable($actor, $organization);

        return OrganizationInvitationResource::collection(
            $invitations->through(fn (OrganizationInvitation $invitation) => (new OrganizationInvitationResource($invitation))->withGrantable($grantable)),
        );
    }

    public function store(StoreOrganizationInvitationRequest $request, Organization $organization): JsonResponse
    {
        $actor = $this->authorize($request, $organization, UserPermission::CREATE->value);

        /** @var array{email: string, role_ids: list<int>} $validated */
        $validated = $request->validated();
        $invitation = $this->invitations->invite($organization, $actor, $validated['email'], $validated['role_ids']);

        return $this->resource($invitation, $actor, $organization)->response()->setStatusCode(201);
    }

    public function resend(Request $request, Organization $organization, OrganizationInvitation $invitation): JsonResource
    {
        $actor = $this->authorize($request, $organization, UserPermission::CREATE->value);
        abort_unless($invitation->organization_id === $organization->getKey(), 404);

        return $this->resource($this->invitations->resend($invitation, $actor), $actor, $organization);
    }

    public function destroy(
        Request $request,
        Organization $organization,
        OrganizationInvitation $invitation,
    ): Response {
        $actor = $this->authorize($request, $organization, UserPermission::CREATE->value);
        abort_unless($invitation->organization_id === $organization->getKey(), 404);

        $this->invitations->revoke($invitation, $actor);

        return response()->noContent();
    }

    private function resource(OrganizationInvitation $invitation, User $actor, Organization $organization): OrganizationInvitationResource
    {
        $invitation->load('invitedBy:id,name');
        $this->invitations->loadRoles(collect([$invitation]));

        return (new OrganizationInvitationResource($invitation))->withGrantable($this->grants->grantable($actor, $organization));
    }

    private function authorize(Request $request, Organization $organization, string $permission): User
    {
        /** @var User $user */
        $user = $request->user();

        abort_unless($this->authorization->allows($user, $organization, $permission), 403);

        return $user;
    }
}
