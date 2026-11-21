<?php

declare(strict_types=1);

// Names under the platform's domain call the API across origins (spec 036, research R5).
// Which of them serve is decided per request by ApplyPortalAddress, which answers 421.
$addressesDomain = strtolower(trim((string) env('PORTAL_ADDRESSES_DOMAIN', ''), " \t\n."));
$addressesOn = in_array(strtolower((string) env('PORTAL_ADDRESSES', 'off')), ['on', 'true', '1'], true) && $addressesDomain !== '';

return [
    'paths' => ['api/*', 'sanctum/csrf-cookie'],
    'allowed_methods' => ['*'],
    'allowed_origins' => array_values(array_filter(array_map(
        static fn (string $origin): string => trim($origin),
        explode(',', env(
            'CORS_ALLOWED_ORIGINS',
            'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://localhost:5175,http://127.0.0.1:5174,http://127.0.0.1:5175',
        )),
    ))),
    'allowed_origins_patterns' => $addressesOn ? ['#^https?://[a-z0-9-]+\.'.preg_quote($addressesDomain, '#').'(:\d+)?$#'] : [],
    'allowed_headers' => ['*'],
    'exposed_headers' => [],
    'max_age' => 0,
    'supports_credentials' => true,
];
