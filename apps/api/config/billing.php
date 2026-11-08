<?php

declare(strict_types=1);

return [
    /*
    | What a billing account gets for an allowance when neither an override nor its
    | plan sets it (specs 028 and 029, ADR-035). `null` is unlimited, except for
    | retention, where it means the platform's retention setting applies. Without
    | plans, nothing changes: alerts, devices and data points stay unlimited, and
    | owners can create one organization, as before.
    */
    'defaults' => [
        'alerts' => null,
        'sms' => (int) env('BILLING_DEFAULT_SMS_ALLOWANCE', 0),
        'devices' => null,
        'data_points' => null,
        'retention_days' => null,
        'organizations' => 1,
    ],

    /*
    | How long cleanup keeps the previous period after a billing change shortens an
    | organization's telemetry retention (spec 029 FR-020). Owners are warned at the
    | change and 7 days before it ends.
    */
    'retention_grace_days' => (int) env('BILLING_RETENTION_GRACE_DAYS', 30),
];
