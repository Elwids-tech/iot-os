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

#[Fillable(['uuid', 'organization_id', 'key', 'name', 'description', 'revision', 'archived_at'])]
final class DeviceProfile extends Model
{
    use HasPublicUuid;
    use HasRevisionEntityTag;

    protected $attributes = [
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

    /** @return HasMany<DeviceProfileVersion, $this> */
    public function versions(): HasMany
    {
        return $this->hasMany(DeviceProfileVersion::class);
    }

    /** @return HasMany<TransportBinding, $this> */
    public function transportBindings(): HasMany
    {
        return $this->hasMany(TransportBinding::class);
    }

    public function isArchived(): bool
    {
        return $this->archived_at !== null;
    }

    protected function entityTagResource(): string
    {
        return 'device-profile';
    }
}
