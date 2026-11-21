<?php

declare(strict_types=1);

namespace App\Domain\Branding\Http\Controllers;

use App\Domain\Branding\Services\PortalAddresses;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * What the proxy asks before it gets a certificate for a host (spec 036, FR-014,
 * research R7): 200 only for an address that serves, or a renamed name still
 * redirecting, so nobody can make the deployment request certificates for names it
 * does not hold. Reached over the private network only; the proxy blocks
 * `/api/internal` from outside.
 */
final class PortalAddressAskController
{
    public function __invoke(Request $request, PortalAddresses $addresses): Response
    {
        $token = config('branding.ask_token');
        abort_unless(is_string($token) && strlen($token) >= 32 && hash_equals($token, (string) $request->query('token')), 401);

        $host = (string) $request->query('domain');
        abort_if($host === '' || ($addresses->resolve($host) === null && $addresses->redirectFor($host) === null), 404);

        return response('', 200);
    }
}
