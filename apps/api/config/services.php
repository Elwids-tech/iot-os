<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Resend, Postmark, AWS, and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    'iot_runtime' => [
        'url' => env('IOT_RUNTIME_URL', 'http://127.0.0.1:8081'),
        'token' => env('IOT_RUNTIME_INTERNAL_TOKEN'),
        'connect_timeout_seconds' => (int) env('IOT_RUNTIME_CONNECT_TIMEOUT_SECONDS', 2),
        'timeout_seconds' => (int) env('IOT_RUNTIME_TIMEOUT_SECONDS', 5),
        'attempts' => (int) env('IOT_RUNTIME_ATTEMPTS', 2),
        'retry_delay_milliseconds' => (int) env('IOT_RUNTIME_RETRY_DELAY_MILLISECONDS', 100),
    ],

];
