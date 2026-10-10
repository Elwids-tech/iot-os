<?php

return [
    'broker_provider' => env('DEVICE_BROKER_PROVIDER', 'emqx'),
    'broker_admin_url' => env('DEVICE_BROKER_ADMIN_URL', 'http://broker-admin:8082'),
    'broker_admin_token' => env('DEVICE_BROKER_ADMIN_TOKEN'),
    'runtime_url' => env('DEVICE_RUNTIME_URL', 'http://runtime:8081'),
    'runtime_token' => env('DEVICE_RUNTIME_TOKEN'),
    'broker_url' => env('DEVICE_MQTT_URL', 'ssl://emqx:8883'),
    'broker_public_url' => env('DEVICE_MQTT_PUBLIC_URL', 'ssl://localhost:8883'),
    'ca_file' => env('DEVICE_MQTT_CA_FILE', '/certs/ca.crt'),
    'emqx_url' => env('DEVICE_EMQX_API_URL', 'http://emqx:18083/api/v5'),
    'emqx_key' => env('DEVICE_EMQX_API_KEY'),
    'emqx_secret' => env('DEVICE_EMQX_API_SECRET'),
    'default_retention_days' => 400,
    // Shared JSON contracts: the repository checkout locally, /var/contracts in images.
    'contracts_path' => env('IOT_CONTRACTS_PATH', is_dir(base_path('../../contracts')) ? base_path('../../contracts') : '/var/contracts'),
];
