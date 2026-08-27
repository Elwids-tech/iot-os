<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Controllers;

use App\Domain\Administration\Http\Requests\StoreOrganizationInvitationRequest;
use App\Domain\Administration\Http\Resources\OrganizationInvitationResource;
use App\Domain\Administration\Models\OrganizationInvitation;
use App\Domain\Administration\Services\OrganizationInvitationManager;
use App\Domain\Authorization\Models\Role;
use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Pagination\LengthAwarePaginator;
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

        $this->loadRoles($invitations);

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
        $this->loadRolesForInvitation($invitation);

        return OrganizationInvitationResource::make($invitation)
            ->response()
            ->setStatusCode(201);
    }

    public function destroy(OrganizationInvitation $invitation): Response
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        abort_unless($invitation->isPending(), 422, 'Only pending invitations can be revoked.');

        $invitation->forceFill(['revoked_at' => now()])->save();

        return response()->noContent();
    }

    /** @param LengthAwarePaginator<int, OrganizationInvitation> $invitations */
    private function loadRoles(LengthAwarePaginator $invitations): void
    {
        $roles = Role::query()
            ->whereIn('id', $invitations->getCollection()->flatMap(fn (OrganizationInvitation $invitation) => $invitation->role_ids)->unique())
            ->get()
            ->keyBy('id');

        $invitations->getCollection()->each(
            fn (OrganizationInvitation $invitation) => $invitation->setRelation(
                'roles',
                $roles->only($invitation->role_ids)->values(),
            ),
        );
    }

    private function loadRolesForInvitation(OrganizationInvitation $invitation): void
    {
        $invitation->setRelation(
            'roles',
            Role::query()->whereIn('id', $invitation->role_ids)->get(),
        );
    }
}
