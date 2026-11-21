<?php

declare(strict_types=1);

namespace App\Domain\Branding\Services;

use App\Domain\Authorization\Services\PlatformAuthorization;
use App\Domain\Branding\Enums\PortalAddressKind;
use App\Domain\Branding\Exceptions\BrandingRefusal;
use App\Domain\Branding\Models\PortalAddress;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

/**
 * Who may use a portal address, and what they reach there (spec 036 US4, research R8).
 * On the platform's own hosts nothing changes. On a billing account's address a person
 * reaches only that account's organizations: those they belong to, or all of them for a
 * super administrator. A billing account never grants access: this only narrows it.
 */
final class PortalAccess
{
    public const CODE = 'not_available_here';

    /** Where {@see ApplyPortalAddress} keeps the request's address, and how it found it. */
    public const ATTRIBUTE = 'portal_address';

    public const VIA = 'portal_address_via';

    /** The session key naming the custom domain a session was started on. */
    public const SESSION_KEY = 'portal_address';

    public function __construct(private readonly PlatformAuthorization $platform) {}

    /** The address the request came from, or null on the platform's own hosts. */
    public function address(?Request $request = null): ?PortalAddress
    {
        $address = ($request ?? request())->attributes->get(self::ATTRIBUTE);

        return $address instanceof PortalAddress ? $address : null;
    }

    /**
     * Whether the address is the request's own host, so its session belongs to that host
     * alone. A name under the platform's domain shares the platform's session instead.
     */
    public function ownsSession(?Request $request = null): bool
    {
        return ($request ?? request())->attributes->get(self::VIA) === 'host';
    }

    /**
     * What a session started at the request's address carries: the custom domain and its
     * activation, so the session works nowhere else and ends when the domain is removed,
     * suspended or claimed again (research R6). Null on the platform's hosts and on a
     * name under the platform's domain, whose session is the platform's.
     */
    public function sessionMark(?Request $request = null): ?string
    {
        $address = $this->address($request);

        return $address === null || $address->kind !== PortalAddressKind::Domain
            ? null
            : $address->getKey().':'.(int) $address->activated_at?->getTimestamp();
    }

    /** Ties the session just started to the request's address. */
    public function bind(Request $request): void
    {
        if (! $request->hasSession()) {
            return;
        }
        $mark = $this->sessionMark($request);
        $mark === null ? $request->session()->forget(self::SESSION_KEY) : $request->session()->put(self::SESSION_KEY, $mark);
    }

    /** Whether the request's session was started at the request's address. */
    public function sessionBelongs(Request $request): bool
    {
        return ! $request->hasSession() || $request->session()->get(self::SESSION_KEY) === $this->sessionMark($request);
    }

    /**
     * Whether the person may be signed in at the request's address (FR-020): they belong
     * to an organization of its account, or hold a platform role.
     */
    public function admits(User $user, ?Request $request = null): bool
    {
        $address = $this->address($request);
        if ($address === null) {
            return true;
        }

        return $this->platform->canAccessAdministration($user)
            || $user->organizations()->where('organizations.billing_account_id', $address->billing_account_id)->exists();
    }

    /** Whether the organization can be reached at the request's address (FR-021). */
    public function reaches(Organization $organization, ?Request $request = null): bool
    {
        $address = $this->address($request);

        return $address === null || (int) $organization->billing_account_id === (int) $address->billing_account_id;
    }

    /**
     * Narrows a query of organizations to the request's address.
     *
     * @template TBuilder of Builder<Organization>
     *
     * @param  TBuilder  $query
     * @return TBuilder
     */
    public function scope(Builder $query, ?Request $request = null): Builder
    {
        $address = $this->address($request);

        return $address === null ? $query : $query->where('organizations.billing_account_id', $address->billing_account_id);
    }

    /** Refuses a sign-in at an address the person cannot use (FR-022: only after their credentials). */
    public function refuse(): never
    {
        throw new BrandingRefusal(403, self::CODE, 'This account cannot sign in at this address.');
    }
}
