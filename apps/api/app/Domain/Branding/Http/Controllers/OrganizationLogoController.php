<?php

declare(strict_types=1);

namespace App\Domain\Branding\Http\Controllers;

use App\Domain\Administration\Services\OrganizationAdministrationAuthorization;
use App\Domain\Branding\Http\Resources\OrganizationLogosResource;
use App\Domain\Branding\Models\BrandAsset;
use App\Domain\Branding\Services\Brands;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Permissions\OrganizationPermission;
use Illuminate\Http\Request;

/**
 * An organization's own logo, for light and dark appearance (spec 036 US2). It needs
 * `Organization.update` and no allowance: every organization may show its logo.
 */
final class OrganizationLogoController
{
    public function __construct(
        private readonly Brands $brands,
        private readonly OrganizationAdministrationAuthorization $authorization,
    ) {}

    /** Sets the logo from a multipart `image`. */
    public function store(Request $request, Organization $organization): OrganizationLogosResource
    {
        return $this->set($request, $organization, BrandAsset::LOGO);
    }

    public function destroy(Request $request, Organization $organization): OrganizationLogosResource
    {
        return $this->remove($request, $organization, BrandAsset::LOGO);
    }

    /** Sets the logo shown on dark appearance from a multipart `image`. */
    public function storeDark(Request $request, Organization $organization): OrganizationLogosResource
    {
        return $this->set($request, $organization, BrandAsset::LOGO_DARK);
    }

    public function destroyDark(Request $request, Organization $organization): OrganizationLogosResource
    {
        return $this->remove($request, $organization, BrandAsset::LOGO_DARK);
    }

    private function set(Request $request, Organization $organization, string $role): OrganizationLogosResource
    {
        $this->authorize($request, $organization);
        $request->validate(['image' => ['required', 'file']]);

        return new OrganizationLogosResource($this->brands->setOrganizationLogo($organization, $role, $request->file('image'), $request->user()));
    }

    private function remove(Request $request, Organization $organization, string $role): OrganizationLogosResource
    {
        $this->authorize($request, $organization);

        return new OrganizationLogosResource($this->brands->removeOrganizationLogo($organization, $role, $request->user()));
    }

    private function authorize(Request $request, Organization $organization): void
    {
        abort_unless($this->authorization->allows($request->user(), $organization, OrganizationPermission::UPDATE->value), 403);
    }
}
