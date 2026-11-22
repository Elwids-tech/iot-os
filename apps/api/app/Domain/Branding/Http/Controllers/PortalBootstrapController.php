<?php

declare(strict_types=1);

namespace App\Domain\Branding\Http\Controllers;

use App\Domain\Branding\Services\BrandImages;
use App\Domain\Branding\Services\PortalBootstrap;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Symfony\Component\HttpFoundation\Response as BaseResponse;

/**
 * What a host that is not the platform's own portal is given before the app starts
 * (spec 036, contracts/portal-bootstrap.md): `runtime-config.js`, the web app manifest
 * and the icons. Public. The settings are never cached: they are how a suspended or
 * released address stops within a minute.
 */
final class PortalBootstrapController
{
    /** Where the portal's proxy keeps the build's own files for this controller to point at (deploy/docker/portal/nginx.conf). */
    public const PLATFORM_FILES = '/platform-files/';

    public function runtimeConfig(Request $request, PortalBootstrap $bootstrap): Response
    {
        return response($bootstrap->script($request->getHost()), 200, [
            'Content-Type' => 'application/javascript; charset=utf-8',
            'Cache-Control' => 'no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    /** The build's manifest under the brand's name, so the installed app is the brand's (FR-031). */
    public function manifest(Request $request, PortalBootstrap $bootstrap): JsonResponse
    {
        $manifest = $bootstrap->manifest($request->getHost());
        abort_if($manifest === null, 404);

        return response()->json($manifest, 200, [
            'Content-Type' => 'application/manifest+json',
            'Cache-Control' => 'no-cache',
            'X-Content-Type-Options' => 'nosniff',
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }

    /**
     * One of the five fixed icon paths. A brand without an icon gets the platform's own
     * file, which only the portal's proxy holds: it is told to send it.
     */
    public function icon(Request $request, string $name, PortalBootstrap $bootstrap, BrandImages $images): BaseResponse
    {
        $icon = $bootstrap->icon($request->getHost(), $name);
        abort_if($icon === null, 404);
        $response = $icon === true ? null : $images->response($icon[0], $icon[1]);
        if ($response === null) {
            return response()->noContent(204, ['X-Accel-Redirect' => self::PLATFORM_FILES.$name]);
        }
        // The path stays while the brand's icon changes, so this is not kept for long.
        $response->headers->set('Cache-Control', 'public, max-age=3600');

        return $response;
    }
}
