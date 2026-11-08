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
    | Data point usage comes from the runtime's reports, about once a minute (spec 029
    | FR-014). An open month not reported for longer than this shows as stale.
    */
    'usage_report_stale_seconds' => (int) env('BILLING_USAGE_REPORT_STALE_SECONDS', 300),
];
