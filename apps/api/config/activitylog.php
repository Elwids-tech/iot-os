<?php

declare(strict_types=1);

use App\Domain\Audit\Models\Activity;
use Spatie\Activitylog\Actions\CleanActivityLogAction;
use Spatie\Activitylog\Actions\LogActivityAction;

// The activity log is the platform's audit trail (ADR-028). Record through
// App\Domain\Audit\Services\ActivityLog, never with activity() directly.
return [

    'enabled' => env('ACTIVITYLOG_ENABLED', true),

    // Not scheduled: an audit retention period is a separate decision (ADR-028).
    'clean_after_days' => 365,

    'default_log_name' => 'audit',

    'default_auth_driver' => null,

    'include_soft_deleted_subjects' => false,

    'activity_model' => Activity::class,

    'default_except_attributes' => [],

    'buffer' => [
        'enabled' => false,
    ],

    'actions' => [
        'log_activity' => LogActivityAction::class,
        'clean_log' => CleanActivityLogAction::class,
    ],
];
