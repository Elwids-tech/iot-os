<?php

return [
    /*
    | White labeling and portal addresses (spec 036, ADR-050). Addresses are off unless
    | the deployment has the wildcard DNS record and proxy for them; brands and logos
    | work without them.
    */
    'addresses_enabled' => in_array(strtolower((string) env('PORTAL_ADDRESSES', 'off')), ['on', 'true', '1'], true),

    // Off only in development, where no DNS exists for a made-up domain.
    'dns_check' => ! in_array(strtolower((string) env('PORTAL_ADDRESSES_DNS_CHECK', 'on')), ['off', 'false', '0'], true),

    // The proxy sends this before it asks for a certificate.
    'ask_token' => env('PORTAL_ADDRESSES_TOKEN'),

    // The platform's domain: names are claimed under it. Null until addresses are set up.
    'domain' => env('PORTAL_ADDRESSES_DOMAIN'),

    // Names nobody can claim, and the prefix of a custom domain's CNAME target.
    'reserved_names' => ['app', 'admin', 'api', 'ops', 'mqtt', 'www', 'docs', 'mail'],
    'claim_prefix' => 'c-',

    // A released name cannot be claimed by another account, and a renamed one redirects, for this long.
    'hold_days' => 30,

    // A custom domain: how long a request waits for its record, how many failed checks
    // make it not reachable, and how often a serving one is looked at again.
    'claim_days' => 7,
    'unreachable_after' => 3,
    'recheck_minutes' => 15,

    /*
    | Where the custom domain check reads a domain's certificate: the deployment's own
    | proxy, as `host:port` inside its network. Empty reads nothing, as in development,
    | where nothing issues certificates. A certificate this close to expiring is shown
    | to the owner and to staff, and raises the release's alert.
    */
    'certificate_probe' => (string) env('PORTAL_ADDRESSES_CERTIFICATE_PROBE', ''),
    'certificate_probe_seconds' => 10,
    'certificate_warning_days' => 14,

    /*
    | Development only: a name's portal calls the API on its own host, through the
    | portal's nginx, instead of on the platform's API host. Browsers do not treat
    | `acme.localhost` and `localhost` as one site, so the shared session cookie of a
    | real deployment cannot be tried locally (research R16).
    */
    'same_origin_names' => in_array(strtolower((string) env('PORTAL_ADDRESSES_SAME_ORIGIN', 'off')), ['on', 'true', '1'], true),

    // The platform's own product name: the **Powered by** line on a branded sign-in page.
    'platform_name' => env('PLATFORM_NAME') ?: 'IoT OS',

    // What the portal's runtime-config.js carries besides the brand (the web images' own values).
    'portal' => [
        'map_style_url' => (string) env('PUBLIC_MAP_STYLE_URL', ''),
        'environment' => (string) env('DEPLOY_ENVIRONMENT', 'local'),
    ],

    /*
    | The web app manifest the portal's build writes (apps/portal/vite.config.ts), kept
    | here so an address can be given the same one under its brand's name. A test
    | compares the two.
    */
    'manifest' => [
        'name' => 'IoT OS',
        'short_name' => 'IoT OS',
        'description' => 'Monitor devices, dashboards and alerts.',
        'id' => '/',
        'start_url' => '/',
        'scope' => '/',
        'display' => 'standalone',
        'background_color' => '#f3f6f9',
        'theme_color' => '#f3f6f9',
        'lang' => 'en',
        'icons' => [
            ['src' => 'pwa-64x64.png', 'sizes' => '64x64', 'type' => 'image/png'],
            ['src' => 'pwa-192x192.png', 'sizes' => '192x192', 'type' => 'image/png'],
            ['src' => 'pwa-512x512.png', 'sizes' => '512x512', 'type' => 'image/png'],
            ['src' => 'maskable-icon-512x512.png', 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'maskable'],
        ],
    ],

    'images' => [
        'max_bytes' => 1048576,
        'icon_min' => 512,
        // Larger images are refused before they are decoded.
        'logo_max' => 2000,
        'icon_max' => 2048,
    ],
];
