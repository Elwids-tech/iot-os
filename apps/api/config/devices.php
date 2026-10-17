<?php

return [
    'broker_admin_url' => env('DEVICE_BROKER_ADMIN_URL', 'http://broker-admin:8082'),
    'broker_admin_token' => env('DEVICE_BROKER_ADMIN_TOKEN'),
    'runtime_url' => env('DEVICE_RUNTIME_URL', 'http://runtime:8081'),
    'runtime_token' => env('DEVICE_RUNTIME_TOKEN'),
    'broker_url' => env('DEVICE_MQTT_URL', 'ssl://mqtt:8883'),
    'broker_public_url' => env('DEVICE_MQTT_PUBLIC_URL', 'ssl://localhost:8883'),
    'ca_file' => env('DEVICE_MQTT_CA_FILE', '/certs/ca.crt'),
    'default_retention_days' => 400,
    // Shared JSON contracts: the repository checkout locally, /var/contracts in images.
    'contracts_path' => env('IOT_CONTRACTS_PATH', is_dir(base_path('../../contracts')) ? base_path('../../contracts') : '/var/contracts'),
];
