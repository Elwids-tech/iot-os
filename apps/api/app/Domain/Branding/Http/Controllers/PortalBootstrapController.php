<?php

declare(strict_types=1);

namespace App\Domain\Branding\Http\Controllers;

use App\Domain\Branding\Services\PortalBootstrap;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * `runtime-config.js` for a host that is not the platform's own portal (spec 036,
 * contracts/portal-bootstrap.md). Public, and never cached: it is how a suspended or
 * released address stops within a minute.
 */
final class PortalBootstrapController
{
    public function runtimeConfig(Request $request, PortalBootstrap $bootstrap): Response
    {
        return response($bootstrap->script($request->getHost()), 200, [
            'Content-Type' => 'application/javascript; charset=utf-8',
            'Cache-Control' => 'no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
