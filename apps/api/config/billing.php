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

    /*
    | How long cleanup keeps the previous period after a billing change shortens an
    | organization's telemetry retention (spec 029 FR-020). Owners are warned at the
    | change and 7 days before it ends.
    */
    'retention_grace_days' => (int) env('BILLING_RETENTION_GRACE_DAYS', 30),

    /*
    | Invoices (spec 029 US6, research R11 and R13). Amounts are integers in the minor
    | units of this one currency (ISO 4217, two decimal places); it also configures card
    | payments, so it must not change once invoices exist. Invoices are due this many
    | days after issue, and accounts whose usage is still not final this many days after
    | a month ends are listed for an administrator to draft anyway.
    */
    'currency' => strtoupper((string) env('BILLING_CURRENCY', 'USD')),
    'invoice_due_days' => (int) env('BILLING_INVOICE_DUE_DAYS', 14),
    'invoice_wait_days' => (int) env('BILLING_INVOICE_WAIT_DAYS', 3),

    /*
    | The smallest amount Stripe charges a card in this currency, in minor units (50 for
    | USD). Less is never sent to Stripe: it is left for an administrator to record.
    */
    'card_minimum' => (int) env('BILLING_CARD_MINIMUM', 50),
];
