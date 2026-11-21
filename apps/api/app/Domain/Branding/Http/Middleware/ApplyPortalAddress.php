<?php

declare(strict_types=1);

namespace App\Domain\Branding\Http\Middleware;

use App\Domain\Branding\Enums\PortalAddressKind;
use App\Domain\Branding\Models\PortalAddress;
use App\Domain\Branding\Services\PortalAccess;
use App\Domain\Branding\Services\PortalAddresses;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Works out which portal address a request came from (spec 036, research R4), before
 * anything else reads it:
 *
 * - the request's own `Host`, when the portal's proxy passed an address's host on;
 * - else the host of `Origin`, or of `Referer`, for a name under the platform's domain,
 *   whose portal calls the platform's API host across origins;
 * - else none: the platform's own hosts, where nothing changes.
 *
 * A host under the platform's domain that is neither one of the platform's own nor an
 * address that serves gets `421 address_not_in_use`, so a suspended or released address
 * stops working for pages already open (FR-017). With addresses switched off this does
 * nothing at all (FR-040). It holds no state between requests (Octane).
 */
final class ApplyPortalAddress
{
    public const NOT_IN_USE = 'address_not_in_use';

    public function __construct(private readonly PortalAddresses $addresses) {}

    public function handle(Request $request, Closure $next): Response
    {
        // Internal callers use service names, and the proxy's `ask` answers for itself.
        if (! $this->addresses->enabled() || $request->is('api/internal/*', 'internal/*', 'up')) {
            return $next($request);
        }

        $bootstrap = $request->is('api/v1/portal/*');
        $host = $request->getHost();
        if ($this->addresses->nameIn($host) !== null) {
            $address = $this->addresses->resolve($host);
            if ($bootstrap) {
                // The bootstrap answers for a host that is not in use itself.
                return $next($this->mark($request, $address, 'host'));
            }
            if ($address === null) {
                return $this->notInUse();
            }
            // A name's portal calls the platform's API host. Only development serves the
            // API on the name itself, where no shared cookie exists to clash with.
            if ($address->kind === PortalAddressKind::Name && ! config('branding.same_origin_names')) {
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
                'fortify.passkeys.allowed_origins' => array_values(array_unique([...(array) config('fortify.passkeys.allowed_origins'), $url])),
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
            'fortify.passkeys.allowed_origins' => array_values(array_unique([
                ...(array) config('fortify.passkeys.allowed_origins'),
                $request->getSchemeAndHttpHost(),
            ])),
        ]);
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
