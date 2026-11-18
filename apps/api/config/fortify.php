<?php

declare(strict_types=1);

use Laravel\Fortify\Features;

/*
 * Fortify supplies only its two-factor actions and code provider (spec 034, ADR-048).
 * Its routes are off (AuthenticationServiceProvider): sign-in, password reset and
 * registration stay ours, and our two-step routes apply `password.confirm` themselves.
 */
return [
    'guard' => 'web',
    'passwords' => 'users',
    'username' => 'email',
    'email' => 'email',
    'lowercase_usernames' => true,
    'home' => '/',
    'prefix' => '',
    'domain' => null,
    'middleware' => ['web'],
    // Passkey sign-in and confirmation: 6 a minute per browser (AuthenticationServiceProvider).
    'limiters' => ['passkeys' => 'passkeys'],
    'views' => false,
    'features' => [
        Features::twoFactorAuthentication(['confirm' => true]),
    ],

    /*
     * Passkeys (spec 034, research R4 and R5). Fortify copies this block into `passkeys.*`
     * when it registers. The relying party is the parent domain of the portal and the
     * admin app (`PASSKEYS_RP_ID`, the release's `DOMAIN`), not the API's own host, so one
     * passkey works in both apps. Changing it makes every passkey stop working.
     */
    'passkeys' => [
        'relying_party_id' => env('PASSKEYS_RP_ID') ?: parse_url((string) env('FRONTEND_URL', 'http://localhost:5173'), PHP_URL_HOST),
        // The portal and the admin app. A development stack that serves them on
        // `localhost` while FRONTEND_URL names 127.0.0.1 lists them here instead.
        'allowed_origins' => array_values(array_filter(array_map(
            static fn (string $origin): string => rtrim(trim($origin), '/'),
            env('PASSKEYS_ALLOWED_ORIGINS')
                ? explode(',', (string) env('PASSKEYS_ALLOWED_ORIGINS'))
                : [(string) env('FRONTEND_URL', 'http://localhost:5173'), (string) env('ADMIN_FRONTEND_URL', 'http://localhost:5174')],
        ))),
        // Generated once per deployment and kept across upgrades, so rotating APP_KEY
        // leaves passkeys working.
        'user_handle_secret' => env('PASSKEYS_USER_HANDLE_SECRET') ?: env('APP_KEY'),
        'timeout' => 60000,
    ],
];
