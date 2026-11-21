<?php

declare(strict_types=1);

namespace App\Domain\Branding\Http\Resources;

use App\Domain\Branding\Services\Brands;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An organization's logos after a change (spec 036 US2): the same three members the
 * organization itself carries.
 *
 * @extends JsonResource<Organization>
 */
final class OrganizationLogosResource extends JsonResource
{
    public function __construct(Organization $resource)
    {
        parent::__construct($resource);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Organization $organization */
        $organization = $this->resource;
        $brand = app(Brands::class)->forOrganization($organization);

        return [
            'uuid' => (string) $organization->uuid,
            /** @var array{url: string, width: int, height: int}|null */
            'logo' => $organization->logo?->image(),
            /** @var array{url: string, width: int, height: int}|null */
            'logo_dark' => $organization->logoDark?->image(),
            /**
             * What the portal shows: the organization's own logo, else its billing account's brand while that is in effect.
             *
             * @var array{product_name: string|null, logo: array{url: string, width: int, height: int}|null, logo_dark: array{url: string, width: int, height: int}|null}
             */
            'brand' => [
                'product_name' => $brand['product_name'],
                'logo' => $brand['logo']?->image(),
                'logo_dark' => $brand['logo_dark']?->image(),
            ],
        ];
    }
}
