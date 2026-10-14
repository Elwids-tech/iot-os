<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Controllers;

use App\Domain\Administration\Exceptions\OrganizationNotEmptyException;
use App\Domain\Administration\Http\Requests\DeleteOrganizationRequest;
use App\Domain\Administration\Http\Resources\OrganizationDeletionEntryResource;
use App\Domain\Administration\Http\Resources\OrganizationDeletionResource;
use App\Domain\Administration\Services\OrganizationDeletion;
use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/** Permanent deletion of organizations that hold nothing worth keeping (spec 006). */
final class PlatformOrganizationDeletionController
{
    public function __construct(private readonly OrganizationDeletion $deletion) {}

    public function show(Organization $organization): OrganizationDeletionResource
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        return new OrganizationDeletionResource(
            $organization,
            $this->deletion->blockers($organization),
            $this->deletion->removes($organization),
        );
    }

    public function destroy(DeleteOrganizationRequest $request, Organization $organization): Response|JsonResponse
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        /** @var User $actor */
        $actor = $request->user();

        try {
            $this->deletion->delete($organization, $actor);
        } catch (OrganizationNotEmptyException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
                'blockers' => OrganizationDeletionEntryResource::collection($exception->blockers),
            ], 409);
        }

        return response()->noContent();
    }
}
