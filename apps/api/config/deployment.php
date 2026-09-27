<?php

return [
    'recovery_mode' => (bool) env('IOT_RECOVERY_MODE', false),
    'demo_enabled' => (bool) env('IOT_STAGING_DEMO_ENABLED', false),
    'ops_enabled' => (bool) env('IOT_OPS_ENABLED', false),
    'metrics_token' => env('IOT_METRICS_TOKEN'),
    'trusted_proxies' => array_filter(explode(',', env('TRUSTED_PROXIES', ''))),
    'worker_name' => env('IOT_WORKER_NAME'),
];
