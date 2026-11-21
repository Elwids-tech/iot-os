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

    'images' => [
        'max_bytes' => 1048576,
        'icon_min' => 512,
        // Larger images are refused before they are decoded.
        'logo_max' => 2000,
        'icon_max' => 2048,
    ],
];
