<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Models;

use App\Domain\Devices\Models\DeviceModel;

final class WebhookDelivery extends DeviceModel
{
    protected $table = 'integration_webhook_deliveries';

    protected function casts(): array
    {
        return ['attempts' => 'integer', 'attempt_limit' => 'integer', 'retry_revision' => 'integer', 'webhook_revision' => 'integer', 'next_attempt_at' => 'immutable_datetime', 'expires_at' => 'immutable_datetime'];
    }
}
