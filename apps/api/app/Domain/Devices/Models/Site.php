<?php

declare(strict_types=1);

namespace App\Domain\Devices\Models;

use App\Domain\Shared\Models\Organization;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** A physical location whose IANA time zone cuts calendar periods for its devices. */
final class Site extends DeviceModel
{
    protected $table = 'sites';

    protected function casts(): array
    {
        return ['latitude' => 'float', 'longitude' => 'float'];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function devices(): HasMany
    {
        return $this->hasMany(Device::class);
    }

    /** @return array<string, mixed> */
    public function toView(): array
    {
        return [
            ...$this->only(['uuid', 'name', 'timezone', 'address', 'latitude', 'longitude']),
            'devices_count' => $this->devices_count ?? null,
        ];
    }
}
