<?php

declare(strict_types=1);

namespace App\Domain\Dashboards\Models;

use App\Domain\Devices\Models\DeviceModel;
use App\Domain\Shared\Models\Organization;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

final class Dashboard extends DeviceModel
{
    protected function casts(): array
    {
        return ['widgets' => 'array', 'layouts' => 'array', 'defaults' => 'array', 'revision' => 'integer'];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }
}
