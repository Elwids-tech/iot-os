<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Models;

use App\Domain\Shared\Models\Concerns\HasPublicUuid;
use App\Domain\Shared\Models\Concerns\HasRevisionEntityTag;
use App\Domain\Shared\Models\Organization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'uuid',
    'organization_id',
    'device_profile_id',
    'key',
    'name',
    'description',
    'transport',
    'revision',
    'archived_at',
])]
final class TransportBinding extends Model
{
    use HasPublicUuid;
    use HasRevisionEntityTag;

    protected $attributes = [
        'transport' => 'native_mqtt_json',
        'revision' => 1,
    ];

    protected function casts(): array
    {
        return [
            'revision' => 'integer',
            'archived_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<Organization, $this> */
    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    /** @return BelongsTo<DeviceProfile, $this> */
    public function profile(): BelongsTo
    {
        return $this->belongsTo(DeviceProfile::class, 'device_profile_id');
    }

    /** @return HasMany<TransportBindingVersion, $this> */
    public function versions(): HasMany
    {
        return $this->hasMany(TransportBindingVersion::class);
    }

    public function isArchived(): bool
    {
        return $this->archived_at !== null;
    }

    protected function entityTagResource(): string
    {
        return 'transport-binding';
    }
}
