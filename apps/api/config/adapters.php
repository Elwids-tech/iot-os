<?php

return [
    'queue_connection' => env('IOT_ADAPTER_QUEUE_CONNECTION', 'database'),
    'enabled' => (bool) env('IOT_ADAPTERS_ENABLED', false),
    'manager_url' => env('IOT_ADAPTER_MANAGER_URL', 'http://adapter-manager:8090'),
    'manager_token' => env('IOT_ADAPTER_MANAGER_TOKEN'),
    'port_base' => (int) env('IOT_ADAPTER_PORT_BASE', 19000),
    'port_limit' => (int) env('IOT_ADAPTER_PORT_LIMIT', 19999),
    'callback_url' => env('IOT_ADAPTER_CALLBACK_URL', 'http://api:8000/api/internal/adapters/events'),
];
