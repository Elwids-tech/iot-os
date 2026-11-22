<?php

declare(strict_types=1);

namespace App\Domain\Authorization\Http\Controllers;

use App\Domain\Branding\Services\PortalAddresses;
use App\Domain\Branding\Services\PortalLinks;
use App\Domain\Shared\Http\Resources\OrganizationResource;
use App\Domain\Shared\Models\Organization;

final class OrganizationContextController
{
    public function show(Organization $organization, PortalLinks $links, PortalAddresses $addresses): OrganizationResource
    {
        // Where a link a person copies should open (spec 036, FR-033): the main address
        // of the organization's billing account. Null when it has none, and the portal
        // keeps the address it is on. The account is read without loading the relation:
        // the resource shows a loaded billing account, and members never see theirs.
        $address = $links->addressOf($organization->billingAccount()->first());
        $organization->setAttribute('portal_url', $address === null ? null : $addresses->url($address));

        return OrganizationResource::make($organization);
    }
}
