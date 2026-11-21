<?php

declare(strict_types=1);

namespace App\Domain\Branding\Http\Controllers;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Branding\Http\Resources\PortalAddressResource;
use App\Domain\Branding\Models\PortalAddress;
use App\Domain\Branding\Services\PortalAddresses;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * Platform staff claim and release a billing account's addresses on its behalf (spec
 * 036 US6), without the allowance check. The route requires
 * `PlatformAdministration.manage-organizations`.
 */
final class PlatformPortalAddressController
{
    public function __construct(private readonly PortalAddresses $addresses) {}

    public function name(Request $request, BillingAccount $billingAccount): PortalAddressResource
    {
        $name = (string) $request->validate(['name' => ['required', 'string', 'max:63']])['name'];
        $address = $this->addresses->claimName($billingAccount, $name, $request->user());
        $address->wasRecentlyCreated = false;

        return new PortalAddressResource($address);
    }

    public function destroy(Request $request, BillingAccount $billingAccount, string $address): Response
    {
        /** @var PortalAddress|null $found */
        $found = $this->addresses->for($billingAccount)->firstWhere('uuid', $address);
        abort_if($found === null, 404);
        $this->addresses->release($found, $request->user());

        return response()->noContent();
    }
}
