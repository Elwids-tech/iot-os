<?php

return [
    'ingest_token' => env('NOTIFICATION_INGEST_TOKEN'),
    'operator_email' => env('NOTIFICATION_OPERATOR_EMAIL', env('ALERT_EMAIL')),
    'portal_url' => env('FRONTEND_URL', 'http://localhost:5173'),
];
