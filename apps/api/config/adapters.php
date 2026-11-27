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
    // Spec 038: OPC UA connections (research R17).
    'opcua' => [
        'max_connections' => (int) env('IOT_OPCUA_MAX_CONNECTIONS', 10),
        'max_points' => (int) env('IOT_OPCUA_MAX_POINTS', 10000),
        'browse_per_minute' => (int) env('IOT_OPCUA_BROWSE_PER_MINUTE', 60),
        // The platform's own container networks, which no allowed private range may include.
        'platform_ranges' => array_values(array_filter(explode(',', (string) env('IOT_ADAPTER_PLATFORM_RANGES', '')))),
    ],
];
