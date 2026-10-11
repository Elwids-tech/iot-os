<?php

return [
    'allowed_hosts' => array_values(array_filter(array_map('trim', explode(',', env('IOT_WEBHOOK_ALLOWED_HOSTS', ''))))),
    // Fixed Docker-only sink, explicitly enabled solely for local verification.
    'local_sink_enabled' => (bool) env('IOT_WEBHOOK_LOCAL_SINK_ENABLED', false),
];
