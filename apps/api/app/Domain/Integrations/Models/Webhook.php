<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Models;

use App\Domain\Devices\Models\DeviceModel;

final class Webhook extends DeviceModel
{
    protected $table = 'integration_webhooks';

    protected $hidden = ['secret'];

    protected function casts(): array
    {
        return ['secret' => 'encrypted', 'enabled' => 'boolean', 'revision' => 'integer', 'grant_revision' => 'integer', 'cursor' => 'integer', 'next_dispatch_at' => 'immutable_datetime'];
    }
}
