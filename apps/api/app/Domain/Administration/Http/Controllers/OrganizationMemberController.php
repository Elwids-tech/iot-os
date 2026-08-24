<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Controllers;

use App\Domain\Administration\Http\Requests\SyncOrganizationMemberRolesRequest;
use App\Domain\Administration\Http\Resources\OrganizationMemberResource;
use App\Domain\Administration\Services\OrganizationAdministrationAuthorization;
use App\Domain\Administration\Services\OrganizationMembershipManager;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use App\Domain\Shared\Permissions\UserPermission;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Http\Response;

final class OrganizationMemberController
{
    public function __construct(
        private readonly OrganizationAdministrationAuthorization $authorization,
        private readonly OrganizationMembershipManager $members,
    ) {}

    public function index(Request $request, Organization $organization): AnonymousResourceCollection
    {
        $this->authorize($request, $organization, UserPermission::VIEW_ANY->value);
        $perPage = min(max((int) $request->query('per_page', 25), 1), 100);

        $members = $this->authorization->withinOrganization($organization, fn () => $organization->users()
            ->with(['roles.permissions'])
            ->orderBy('name')
            ->paginate($perPage)
            ->withQueryString());

        return OrganizationMemberResource::collection($members);
    }

    public function update(
        SyncOrganizationMemberRolesRequest $request,
        Organization $organization,
        User $member,
    ): JsonResource {
        $this->authorize($request, $organization, UserPermission::UPDATE->value);

        /** @var array{role_ids: list<int>} $validated */
        $validated = $request->validated();
        $this->members->syncRoles($organization, $member, $validated['role_ids']);

        $this->authorization->withinOrganization($organization, fn () => $member->load('roles.permissions'));

        return OrganizationMemberResource::make($member);
    }

    public function destroy(Request $request, Organization $organization, User $member): Response
    {
        $this->authorize($request, $organization, UserPermission::DELETE->value);
        $this->members->remove($organization, $member);

        return response()->noContent();
    }

    private function authorize(Request $request, Organization $organization, string $permission): void
    {
        /** @var User $user */
        $user = $request->user();

        abort_unless($this->authorization->allows($user, $organization, $permission), 403);
    }
}
