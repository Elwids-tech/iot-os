<?php

declare(strict_types=1);

namespace App\Domain\Branding\Http\Controllers;

use App\Domain\Branding\Models\BrandAsset;
use App\Domain\Branding\Services\BrandImages;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * A brand image, public because the sign-in page shows it before anyone signs in (spec
 * 036). Its name carries the start of its content hash, so it is cached for a year and a
 * changed image gets a new address. Unknown, pruned and mismatched names answer 404.
 */
final class BrandAssetController
{
    public function __construct(private readonly BrandImages $images) {}

    public function show(string $asset, string $variant): StreamedResponse
    {
        $found = BrandAsset::query()->where('uuid', substr($asset, 0, 36))->first();
        abort_if($found === null || ! hash_equals($found->publicKey(), $asset), 404);

        $response = $this->images->response($found, $variant);
        abort_if($response === null, 404);

        return $response;
    }
}
