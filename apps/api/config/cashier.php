<?php

declare(strict_types=1);

/*
| Card payments through Stripe and Laravel Cashier (spec 029 US7, ADR-037). Without
| STRIPE_SECRET, payments are off: invoices are still issued and administrators record
| payments by hand. STRIPE_WEBHOOK_SECRET is then required too, or webhooks are refused.
| Real keys live only in private environment files, never in the repository.
*/
return [
    'key' => env('STRIPE_KEY'),
    'secret' => env('STRIPE_SECRET'),

    // Cashier's own routes are off; the webhook is `POST /api/stripe/webhook` (billing routes).
    'path' => 'api/stripe',

    'webhook' => [
        'secret' => env('STRIPE_WEBHOOK_SECRET'),
        'tolerance' => (int) env('STRIPE_WEBHOOK_TOLERANCE', 300),
        // What `php artisan cashier:webhook` subscribes the endpoint to (contracts/stripe-webhooks.md).
        'events' => [
            'checkout.session.completed',
            'payment_intent.succeeded',
            'payment_intent.payment_failed',
            'payment_method.detached',
        ],
    ],

    // The deployment's one billing currency (config/billing.php), as Stripe writes it.
    'currency' => strtolower((string) env('BILLING_CURRENCY', 'USD')),
    'currency_locale' => env('CASHIER_CURRENCY_LOCALE', 'en'),

    'payment_notification' => null,

    'logger' => env('CASHIER_LOGGER'),
];
