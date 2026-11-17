<?php

declare(strict_types=1);
use NotificationChannels\WebPush\PushSubscription;

/*
 * Push alerts (spec 033). The deployment's VAPID key pair signs every push; push is
 * available only while both halves are set (App\Domain\Notifications\Services\WebPush).
 * Devices live in our own `push_devices` table, so the package's model and table
 * settings are unused.
 */
return [
    'vapid' => [
        'subject' => env('WEBPUSH_VAPID_SUBJECT'),
        'public_key' => env('WEBPUSH_VAPID_PUBLIC_KEY'),
        'private_key' => env('WEBPUSH_VAPID_PRIVATE_KEY'),
        'pem_file' => null,
    ],

    'model' => PushSubscription::class,

    'table_name' => 'push_subscriptions',

    'database_connection' => env('DB_CONNECTION', 'pgsql'),

    'client_options' => [],

    'automatic_padding' => true,
];
