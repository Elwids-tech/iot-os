<?php

return [
    'recovery_mode' => (bool) env('IOT_RECOVERY_MODE', false),
    'demo_enabled' => (bool) env('IOT_STAGING_DEMO_ENABLED', false),
    'ops_enabled' => (bool) env('IOT_OPS_ENABLED', false),
    'metrics_token' => env('IOT_METRICS_TOKEN'),
    'trusted_proxies' => array_filter(explode(',', env('TRUSTED_PROXIES', ''))),
    'worker_name' => env('IOT_WORKER_NAME'),
    'expected_workers' => array_values(array_intersect(
        ['default', 'alerts', 'assistant', 'webhooks', 'scheduler', 'automation'],
        explode(',', env('IOT_OPS_WORKERS', 'default,alerts,assistant,webhooks,scheduler,automation')),
    )),
    'expected_simulators' => (int) env('IOT_OPS_EXPECTED_SIMULATORS', 0),
];
