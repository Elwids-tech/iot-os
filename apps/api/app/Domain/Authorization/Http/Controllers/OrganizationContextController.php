<?php

declare(strict_types=1);

namespace App\Domain\Authorization\Http\Controllers;

use App\Domain\Shared\Http\Resources\OrganizationResource;
use App\Domain\Shared\Models\Organization;

final class OrganizationContextController
{
    public function show(Organization $organization): OrganizationResource
    {
        return OrganizationResource::make($organization);
    }
}
