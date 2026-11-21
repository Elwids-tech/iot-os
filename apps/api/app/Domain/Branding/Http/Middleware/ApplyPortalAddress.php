<?php

declare(strict_types=1);

namespace App\Domain\Branding\Http\Middleware;

use App\Domain\Branding\Enums\PortalAddressKind;
use App\Domain\Branding\Models\PortalAddress;
use App\Domain\Branding\Services\PortalAccess;
use App\Domain\Branding\Services\PortalAddresses;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cookie;
use Symfony\Component\HttpFoundation\Response;

/**
 * Works out which portal address a request came from (spec 036, research R4), before
 * anything else reads it:
 *
 * - the request's own `Host`, when the portal's proxy passed an address's host on: a
 *   custom domain, whose portal calls the API on its own host (research R6);
 * - else the host of `Origin`, or of `Referer`, for a name under the platform's domain,
 *   whose portal calls the platform's API host across origins;
 * - else none: the platform's own hosts, where nothing changes.
 *
 * A host under the platform's domain that is neither one of the platform's own nor an
 * address that serves, and any other host the proxy passed on that is not an address
 * that serves, gets `421 address_not_in_use`, so a suspended or released address
 * stops working for pages already open (FR-017). With addresses switched off this does
 * nothing at all (FR-040). It holds no state between requests (Octane).
 */
final class ApplyPortalAddress
{
    public const NOT_IN_USE = 'address_not_in_use';

    /** Set by the portal's proxy on every request for a host that is not the platform's own. */
    public const PROXIED = 'X-Portal-Address';

    /** What a custom domain never serves. */
    private const PLATFORM_ONLY = ['api/v1/admin', 'api/v1/admin/*', 'api/v1/agent-authorizations', 'api/v1/agent-authorizations/*', 'mcp', 'mcp/*', 'oauth/*', '.well-known/*', 'api/stripe/*'];

    public function __construct(private readonly PortalAddresses $addresses) {}

    public function handle(Request $request, Closure $next): Response
    {
        // Internal callers use service names, and the proxy's `ask` answers for itself.
        if (! $this->addresses->enabled() || $request->is('api/internal/*', 'internal/*', 'up')) {
            return $next($request);
        }

        $bootstrap = $request->is('api/v1/portal/*');
        $host = $request->getHost();
        // The platform's API host is never an address; nearly every request stops here.
        $own = PortalAddresses::host($host) === parse_url((string) config('app.url'), PHP_URL_HOST);
        $address = $own ? null : $this->addresses->resolve($host);
        // A name under the platform's domain, a custom domain that serves, or any other
        // host the portal's proxy passed on as an address.
        if (! $own && ($address !== null || $this->addresses->nameIn($host) !== null || $request->headers->has(self::PROXIED))) {
            if ($bootstrap) {
                // The bootstrap answers for a host that is not in use itself.
                return $next($this->mark($request, $address, 'host'));
            }
            if ($address === null) {
                return $this->notInUse();
            }
            if ($address->kind === PortalAddressKind::Domain) {
                // The admin app, agents and applications stay on the platform's domain (research R6).
                abort_if($request->is(...self::PLATFORM_ONLY), 404);
                $this->ownDomain($request);

                return $next($this->mark($request, $address, 'host'));
            }
            // A name's portal calls the platform's API host. Only development serves the
            // API on the name itself, where no shared cookie exists to clash with.
            if (! config('branding.same_origin_names')) {
                abort(404);
            }
            $this->ownHost($request);

            return $next($this->mark($request, $address, 'host'));
        }

        $origin = $this->originHost($request);
        if ($origin !== null && $this->addresses->nameIn($origin) !== null) {
            $address = $this->addresses->resolve($origin);
            if ($address === null) {
                return $bootstrap ? $next($request) : $this->notInUse();
            }
            // The name's portal is a first-party page for this request: its session is the
            // platform's (research R5), and passkeys made on the platform's domain work
            // there (FR-026). Only an address that serves gets this, never the whole domain.
            $url = $this->addresses->url($address);
            config([
                'sanctum.stateful' => array_values(array_unique([...(array) config('sanctum.stateful'), (string) preg_replace('#^https?://#', '', $url)])),
                'passkeys.allowed_origins' => array_values(array_unique([...(array) config('passkeys.allowed_origins'), $url])),
            ]);

            return $next($this->mark($request, $address, 'origin'));
        }

        return $next($request);
    }

    private function mark(Request $request, ?PortalAddress $address, string $via): Request
    {
        if ($address !== null) {
            $request->attributes->set(PortalAccess::ATTRIBUTE, $address);
            $request->attributes->set(PortalAccess::VIA, $via);
        }

        return $request;
    }

    /** The session and its cookies belong to this host alone, for this request. */
    private function ownHost(Request $request): void
    {
        config([
            'session.domain' => null,
            'sanctum.stateful' => array_values(array_unique([...(array) config('sanctum.stateful'), $request->getHttpHost()])),
            'passkeys.allowed_origins' => array_values(array_unique([
                ...(array) config('passkeys.allowed_origins'),
                $request->getSchemeAndHttpHost(),
            ])),
        ]);
        $this->hostOnlyCookies();
    }

    /**
     * A custom domain is its own site (research R6): its cookies are host-only, only it
     * is a first-party page, and passkeys made there belong to it (FR-026).
     */
    private function ownDomain(Request $request): void
    {
        config([
            'session.domain' => null,
            'sanctum.stateful' => [$request->getHttpHost()],
            'passkeys.relying_party_id' => PortalAddresses::host($request->getHost()),
            'passkeys.allowed_origins' => [$request->getSchemeAndHttpHost()],
        ]);
        $this->hostOnlyCookies();
    }

    /** Queued cookies, such as the kept sign-in, take the cookie jar's default domain when they name none. */
    private function hostOnlyCookies(): void
    {
        Cookie::setDefaultPathAndDomain((string) config('session.path', '/'), null, config('session.secure'), config('session.same_site'));
    }

    private function originHost(Request $request): ?string
    {
        foreach (['Origin', 'Referer'] as $header) {
            $host = parse_url((string) $request->headers->get($header), PHP_URL_HOST);
            if (is_string($host) && $host !== '') {
                return $host;
            }
        }

        return null;
    }

    private function notInUse(): Response
    {
        return response()->json(['message' => 'This address is not in use.', 'code' => self::NOT_IN_USE], 421);
    }
}
