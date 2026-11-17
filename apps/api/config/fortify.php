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
    'limiters' => [],
    'views' => false,
    'features' => [
        Features::twoFactorAuthentication(['confirm' => true]),
    ],
];
