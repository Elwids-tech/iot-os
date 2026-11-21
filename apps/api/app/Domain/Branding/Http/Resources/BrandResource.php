<?php

declare(strict_types=1);

namespace App\Domain\Branding\Http\Resources;

use App\Domain\Branding\Models\Brand;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A billing account's brand (spec 036). Before anything is saved it is empty at
 * revision 0. `in_effect` is false while the account's plan has no branding or the
 * brand has no product name: the platform's name shows instead.
 *
 * @extends JsonResource<Brand>
 */
final class BrandResource extends JsonResource
{
    public function __construct(Brand $resource, private readonly bool $inEffect)
    {
        parent::__construct($resource);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Brand $brand */
        $brand = $this->resource;

        return [
            /** Shown in titles and on the sign-in page; at most 40 characters. */
            'product_name' => $brand->product_name === null ? null : (string) $brand->product_name,
            /** The installed app's name; at most 12 characters. */
            'short_name' => $brand->short_name === null ? null : (string) $brand->short_name,
            /** An `https:` or `mailto:` link. */
            'support_url' => $brand->support_url === null ? null : (string) $brand->support_url,
            /** @var array{url: string, width: int, height: int}|null */
            'logo' => $brand->logo?->image(),
            /** @var array{url: string, width: int, height: int}|null */
            'logo_dark' => $brand->logoDark?->image(),
            /** @var array{url: string, width: int, height: int}|null */
            'icon' => $brand->icon?->image(),
            'in_effect' => (bool) $this->inEffect,
            /** Send it back with a change; a brand changed since answers 409. */
            'revision' => (int) $brand->revision,
        ];
    }
}
