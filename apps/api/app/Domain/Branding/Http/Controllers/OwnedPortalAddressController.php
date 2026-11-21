<?php

declare(strict_types=1);

namespace App\Domain\Branding\Http\Controllers;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\Allowances;
use App\Domain\Branding\Enums\PortalAddressState;
use App\Domain\Branding\Exceptions\BrandingRefusal;
use App\Domain\Branding\Http\Resources\PortalAddressResource;
use App\Domain\Branding\Models\PortalAddress;
use App\Domain\Branding\Services\PortalAddresses;
use App\Domain\Shared\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * A billing account's portal addresses for its owners (spec 036 US1). An account the
 * signed-in person does not own answers 404, as does another account's address.
 */
final class OwnedPortalAddressController
{
    public function __construct(
        private readonly PortalAddresses $addresses,
        private readonly Allowances $allowances,
    ) {}

    /** Claims a name under the platform's domain, or renames the one the account holds. */
    public function name(Request $request, string $billingAccount): PortalAddressResource
    {
        $account = $this->account($request, $billingAccount);
        if (! $this->allowances->allows($account, AllowanceKind::Branding)) {
            throw new BrandingRefusal(403, 'branding_not_allowed', 'Branding is not part of this billing account\'s plan.');
        }
        $name = (string) $request->validate(['name' => ['required', 'string', 'max:63']])['name'];
        $address = $this->addresses->claimName($account, $name, $request->user());
        // Renaming keeps the resource: the account still has its one name.
        $address->wasRecentlyCreated = false;

        return new PortalAddressResource($address);
    }

    /** Asks for a custom domain. It serves once its CNAME record is found. */
    public function domain(Request $request, string $billingAccount): PortalAddressResource
    {
        $account = $this->account($request, $billingAccount);
        if (! $this->allowances->allows($account, AllowanceKind::Branding) || ! $this->allowances->allows($account, AllowanceKind::CustomDomain)) {
            throw new BrandingRefusal(403, 'custom_domain_not_allowed', 'A custom domain is not part of this billing account\'s plan.');
        }
        $host = (string) $request->validate(['host' => ['required', 'string', 'max:260']])['host'];
        $address = $this->addresses->claimDomain($account, $host, $request->user());
        $address->wasRecentlyCreated = false;

        return new PortalAddressResource($address);
    }

    /** Looks the domain's DNS record up now, at most once a minute. */
    public function check(Request $request, string $billingAccount, string $address): PortalAddressResource
    {
        $account = $this->account($request, $billingAccount);
        /** @var PortalAddress|null $found */
        $found = $this->addresses->for($account)->firstWhere('uuid', $address);
        abort_if($found === null, 404);

        return new PortalAddressResource($this->addresses->checkNow($found));
    }

    /** Releases an address. Staff lift a suspension first. */
    public function destroy(Request $request, string $billingAccount, string $address): Response
    {
        $account = $this->account($request, $billingAccount);
        /** @var PortalAddress|null $found */
        $found = $this->addresses->for($account)->firstWhere('uuid', $address);
        abort_if($found === null, 404);
        if ($found->state === PortalAddressState::Suspended) {
            throw new BrandingRefusal(409, 'suspended', 'This address is suspended. Contact support to remove it.');
        }
        $this->addresses->release($found, $request->user());

        return response()->noContent();
    }

    private function account(Request $request, string $uuid): BillingAccount
    {
        /** @var User $user */
        $user = $request->user();
        /** @var BillingAccount|null $account */
        $account = $user->ownedBillingAccounts()->where('billing_accounts.uuid', $uuid)->first();
        abort_if($account === null, 404);

        return $account;
    }
}
