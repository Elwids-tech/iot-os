<?php

declare(strict_types=1);

namespace App\Domain\Branding\Http\Controllers;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Branding\Http\Resources\PlatformPortalAddressResource;
use App\Domain\Branding\Http\Resources\PortalAddressResource;
use App\Domain\Branding\Models\PortalAddress;
use App\Domain\Branding\Services\PortalAddresses;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;

/**
 * Platform staff see every portal address, suspend and restore one, and claim and
 * release a billing account's addresses on its behalf without the allowance check (spec
 * 036 US6, FR-036). The routes require `PlatformAdministration.manage-organizations`.
 */
final class PlatformPortalAddressController
{
    /** What the list shows and can be narrowed to: every state but `released`. */
    private const LISTED = ['waiting_dns', 'active', 'unreachable', 'suspended', 'lapsed'];

    public function __construct(private readonly PortalAddresses $addresses) {}

    /**
     * Every billing account's portal addresses.
     *
     * Ordered by host. A released address is not listed. `serving` is false for an
     * address whose state serves while its account's allowance is off.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $request->validate([
            /** Only addresses in this state: `waiting_dns`, `active`, `unreachable`, `suspended` or `lapsed`. */
            'state' => ['nullable', Rule::in(self::LISTED)],
            /** Matches the host or the billing account's name. */
            'search' => ['nullable', 'string', 'max:255'],
            /** Addresses per page, 1 to 100 (default 25). */
            'per_page' => ['nullable', 'integer'],
        ]);
        $state = (string) $request->query('state', '');
        $search = trim((string) $request->query('search', ''));
        $perPage = min(max((int) $request->query('per_page', 25), 1), 100);

        $addresses = PortalAddress::query()
            ->with('billingAccount')
            ->whereIn('state', $state === '' ? self::LISTED : [$state])
            ->when($search !== '', fn ($query) => $query->where(fn ($query) => $query
                ->whereLike('host', "%{$search}%")
                ->orWhereHas('billingAccount', fn ($account) => $account->whereLike('name', "%{$search}%"))))
            ->orderBy('host')
            ->paginate($perPage)
            ->withQueryString();

        return PlatformPortalAddressResource::collection($addresses);
    }

    /**
     * Stops an address at once.
     *
     * It serves nothing within a minute, whoever is signed in on a custom domain is
     * signed out there, and its owners can neither change nor remove it. Suspending a
     * suspended address changes nothing. A released or lapsed address answers 404.
     */
    public function suspend(Request $request, PortalAddress $address): PlatformPortalAddressResource
    {
        abort_unless($address->state->isLive(), 404);

        return new PlatformPortalAddressResource($this->addresses->suspend($address, $request->user()));
    }

    /**
     * Lifts a suspension.
     *
     * A name serves at once. A custom domain is checked now: it serves if its DNS record
     * is still there, else it waits for the record again. Restoring an address that is
     * not suspended changes nothing. A released or lapsed address answers 404.
     */
    public function restore(Request $request, PortalAddress $address): PlatformPortalAddressResource
    {
        abort_unless($address->state->isLive(), 404);

        return new PlatformPortalAddressResource($this->addresses->restore($address, $request->user()));
    }

    public function name(Request $request, BillingAccount $billingAccount): PortalAddressResource
    {
        $name = (string) $request->validate(['name' => ['required', 'string', 'max:63']])['name'];
        $address = $this->addresses->claimName($billingAccount, $name, $request->user());
        $address->wasRecentlyCreated = false;

        return new PortalAddressResource($address);
    }

    public function domain(Request $request, BillingAccount $billingAccount): PortalAddressResource
    {
        $host = (string) $request->validate(['host' => ['required', 'string', 'max:260']])['host'];
        $address = $this->addresses->claimDomain($billingAccount, $host, $request->user());
        $address->wasRecentlyCreated = false;

        return new PortalAddressResource($address);
    }

    public function check(BillingAccount $billingAccount, string $address): PortalAddressResource
    {
        /** @var PortalAddress|null $found */
        $found = $this->addresses->for($billingAccount)->firstWhere('uuid', $address);
        abort_if($found === null, 404);

        return new PortalAddressResource($this->addresses->checkNow($found));
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
