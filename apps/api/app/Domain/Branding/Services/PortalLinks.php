<?php

declare(strict_types=1);

namespace App\Domain\Branding\Services;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Branding\Enums\PortalAddressKind;
use App\Domain\Branding\Models\PortalAddress;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;

/**
 * Where a link the platform writes for a person opens (spec 036, research R11, FR-016,
 * FR-033): the one place that decides the host of a portal link.
 *
 * - About an organization: its account's main address, which is its custom domain while
 *   that serves, else its name, else the platform's portal.
 * - With no organization (a password reset, a security notice): the address the request
 *   came from. Queued mail has no request when it is built, so the message keeps
 *   `origin()` from the request that made it and gives it back to `at()`.
 * - Billing and staff mail: always the platform's portal.
 */
final class PortalLinks
{
    public function __construct(
        private readonly PortalAddresses $addresses,
        private readonly PortalAccess $access,
    ) {}

    public function forOrganization(?Organization $organization, string $path = ''): string
    {
        return $this->to($this->addressOf($organization?->billingAccount), $path);
    }

    public function forRequest(string $path = '', ?Request $request = null): string
    {
        return $this->to($this->access->address($request), $path);
    }

    public function platform(string $path = ''): string
    {
        return rtrim((string) config('app.frontend_url'), '/').self::path($path);
    }

    /** The host of the address this request came from, for a queued message to keep. Null on the platform's hosts. */
    public function origin(?Request $request = null): ?string
    {
        return $this->access->address($request)?->host;
    }

    /** A link at a host kept by `origin()`. An address that stopped serving since falls back to the platform's portal. */
    public function at(?string $host, string $path = ''): string
    {
        return $this->to($host === null ? null : $this->addresses->resolve($host), $path);
    }

    /** The account's main address, or null for the platform's portal. */
    public function addressOf(?BillingAccount $account): ?PortalAddress
    {
        return $account === null ? null : $this->addresses->mainFor($account);
    }

    /**
     * Where an address's API answers, for an image in a mail: the address itself when it
     * serves the API on its own host, else the platform's API host.
     */
    public function apiBase(?PortalAddress $address): string
    {
        return $address !== null && ($address->kind === PortalAddressKind::Domain || config('branding.same_origin_names'))
            ? $this->addresses->url($address)
            : rtrim((string) config('app.url'), '/');
    }

    private function to(?PortalAddress $address, string $path): string
    {
        return $address === null ? $this->platform($path) : $this->addresses->url($address).self::path($path);
    }

    private static function path(string $path): string
    {
        return $path === '' ? '' : '/'.ltrim($path, '/');
    }
}
