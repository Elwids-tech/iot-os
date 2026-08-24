<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Controllers;

use App\Domain\Administration\Services\OrganizationAdministrationAuthorization;
use App\Domain\Shared\Http\Resources\OrganizationResource;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use App\Domain\Shared\Permissions\OrganizationPermission;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class OrganizationAdministrationController
{
    public function __construct(private readonly OrganizationAdministrationAuthorization $authorization) {}

    public function show(Request $request, Organization $organization): JsonResource
    {
        /** @var User $user */
        $user = $request->user();

        abort_unless($this->authorization->allows($user, $organization, OrganizationPermission::VIEW->value), 403);

        return OrganizationResource::make($organization);
    }
}
