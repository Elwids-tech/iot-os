<?php

declare(strict_types=1);

namespace App\Domain\Dashboards\Models;

use App\Domain\Devices\Models\DeviceModel;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

final class Dashboard extends DeviceModel
{
    protected function casts(): array
    {
        return ['widgets' => 'array', 'layouts' => 'array', 'defaults' => 'array', 'tags' => 'array', 'revision' => 'integer'];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function updater(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }

    public function shares(): HasMany
    {
        return $this->hasMany(DashboardShare::class);
    }
}
