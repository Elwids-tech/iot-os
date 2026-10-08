<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Models;

use App\Domain\Devices\Models\DeviceModel;

final class AdapterTenant extends DeviceModel
{
    protected $table = 'device_adapter_tenants';

    protected $hidden = ['runtime_token', 'ingress_admin_password'];

    protected function casts(): array
    {
        return ['runtime_token' => 'encrypted', 'ingress_admin_password' => 'encrypted', 'listen_port' => 'integer'];
    }
}
