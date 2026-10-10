<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Controllers;

use App\Domain\Administration\Http\Requests\SyncOrganizationMemberRolesRequest;
use App\Domain\Administration\Http\Resources\OrganizationMemberResource;
use App\Domain\Administration\Services\OrganizationAdministrationAuthorization;
use App\Domain\Administration\Services\OrganizationGrants;
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
        private readonly OrganizationGrants $grants,
    ) {}

    public function index(Request $request, Organization $organization): AnonymousResourceCollection
    {
        $actor = $this->authorize($request, $organization, UserPermission::VIEW_ANY->value);
        $perPage = min(max((int) $request->query('per_page', 25), 1), 100);
        $search = trim((string) $request->query('search', ''));
        $grantable = $this->grants->grantable($actor, $organization);

        $members = $this->authorization->withinOrganization($organization, fn () => $organization->users()
            ->with(['roles.permissions'])
            ->when($search !== '', function ($query) use ($search): void {
                $query->where(function ($query) use ($search): void {
                    $query->where('name', 'like', "%{$search}%")
                        ->orWhere('email', 'like', "%{$search}%");
                });
            })
            ->orderBy('name')
            ->paginate($perPage)
            ->withQueryString());

        return OrganizationMemberResource::collection(
            $members->through(fn (User $member) => (new OrganizationMemberResource($member))->withGrantable($grantable)),
        );
    }

    public function update(
        SyncOrganizationMemberRolesRequest $request,
        Organization $organization,
        User $member,
    ): JsonResource {
        $actor = $this->authorize($request, $organization, UserPermission::UPDATE->value);

        /** @var array{role_ids: list<int>} $validated */
        $validated = $request->validated();
        $this->members->syncRoles($organization, $actor, $member, $validated['role_ids']);

        $this->authorization->withinOrganization($organization, fn () => $member->load('roles.permissions'));

        return (new OrganizationMemberResource($member))->withGrantable($this->grants->grantable($actor, $organization));
    }

    public function destroy(Request $request, Organization $organization, User $member): Response
    {
        $actor = $this->authorize($request, $organization, UserPermission::DELETE->value);
        $this->members->remove($organization, $actor, $member);

        return response()->noContent();
    }

    private function authorize(Request $request, Organization $organization, string $permission): User
    {
        /** @var User $user */
        $user = $request->user();

        abort_unless($this->authorization->allows($user, $organization, $permission), 403);

        return $user;
    }
}
