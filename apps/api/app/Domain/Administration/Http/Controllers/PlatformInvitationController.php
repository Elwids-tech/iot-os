<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Controllers;

use App\Domain\Administration\Http\Requests\StoreOrganizationInvitationRequest;
use App\Domain\Administration\Http\Resources\OrganizationInvitationResource;
use App\Domain\Administration\Models\OrganizationInvitation;
use App\Domain\Administration\Services\OrganizationInvitationManager;
use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

final class PlatformInvitationController
{
    public function __construct(private readonly OrganizationInvitationManager $invitations) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        $search = trim((string) $request->query('search', ''));
        $perPage = min(max((int) $request->query('per_page', 25), 1), 100);

        $invitations = OrganizationInvitation::query()
            ->with('organization')
            ->when($search !== '', fn ($query) => $query->where('email', 'like', "%{$search}%"))
            ->latest()
            ->paginate($perPage)
            ->withQueryString();

        $this->invitations->loadRoles($invitations->getCollection());

        return OrganizationInvitationResource::collection($invitations);
    }

    public function store(
        StoreOrganizationInvitationRequest $request,
        Organization $organization,
    ): JsonResponse {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        /** @var User $user */
        $user = $request->user();
        /** @var array{email: string, role_ids: list<int>} $validated */
        $validated = $request->validated();

        $invitation = $this->invitations->invite($organization, $user, $validated['email'], $validated['role_ids']);
        $invitation->load('organization');
        $this->invitations->loadRoles(collect([$invitation]));

        return OrganizationInvitationResource::make($invitation)
            ->response()
            ->setStatusCode(201);
    }

    public function destroy(Request $request, OrganizationInvitation $invitation): Response
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        /** @var User $user */
        $user = $request->user();
        $this->invitations->revoke($invitation, $user);

        return response()->noContent();
    }
}
