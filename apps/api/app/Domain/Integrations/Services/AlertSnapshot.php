<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Services;

use App\Domain\Automation\Models\Alert;
use App\Domain\Automation\Services\AlertQuery;

final class AlertSnapshot
{
    public static function of(Alert $alert): array
    {
        return [...$alert->only(['uuid', 'episode', 'activated_at', 'cleared_at', 'acknowledged_at']), 'condition' => $alert->cleared_at ? 'cleared' : 'active', 'workflow_uuid' => $alert->workflow?->uuid, 'workflow_name' => $alert->workflow?->name, 'device_uuid' => AlertQuery::boundDevice($alert), 'execution_stopped_reason' => $alert->deployment?->stopped_reason];
    }
}
