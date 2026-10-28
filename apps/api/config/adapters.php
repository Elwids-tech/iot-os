<?php

return [
    'queue_connection' => env('IOT_ADAPTER_QUEUE_CONNECTION', 'database'),
    'enabled' => (bool) env('IOT_ADAPTERS_ENABLED', false),
    'manager_url' => env('IOT_ADAPTER_MANAGER_URL', 'http://adapter-manager:8090'),
    'manager_token' => env('IOT_ADAPTER_MANAGER_TOKEN'),
    'port_base' => (int) env('IOT_ADAPTER_PORT_BASE', 19000),
    'port_limit' => (int) env('IOT_ADAPTER_PORT_LIMIT', 19999),
    'callback_url' => env('IOT_ADAPTER_CALLBACK_URL', 'http://api:8000/api/internal/adapters/events'),
    // Spec 020: the public address of the webhook receiver (ADR-022); empty disables webhook sources.
    'webhook_public_url' => env('IOT_WEBHOOK_PUBLIC_URL'),
    'receiver_token' => env('IOT_WEBHOOK_RECEIVER_TOKEN'),
    // Development only: lets polling reach simulators on private addresses and plain HTTP.
    'allow_private_endpoints' => (bool) env('IOT_ADAPTER_ALLOW_PRIVATE_BROKERS', false),
];
