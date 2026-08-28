<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Models;

use App\Domain\DeviceManagement\Enums\DeviceLifecycleState;
use App\Domain\Shared\Models\Concerns\HasPublicUuid;
use App\Domain\Shared\Models\Concerns\HasRevisionEntityTag;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

#[Fillable([
    'uuid',
    'organization_id',
    'external_id',
    'name',
    'description',
    'lifecycle_state',
    'revision',
    'registered_at',
    'archived_at',
    'created_by_id',
])]
final class Device extends Model
{
    use HasPublicUuid;
    use HasRevisionEntityTag;

    protected $attributes = [
        'lifecycle_state' => 'draft',
        'revision' => 1,
    ];

    protected function casts(): array
    {
        return [
            'lifecycle_state' => DeviceLifecycleState::class,
            'revision' => 'integer',
            'registered_at' => 'immutable_datetime',
            'archived_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<Organization, $this> */
    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    /** @return BelongsTo<User, $this> */
    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by_id');
    }

    /** @return HasOne<DeviceDefinitionAssignment, $this> */
    public function definitionAssignment(): HasOne
    {
        return $this->hasOne(DeviceDefinitionAssignment::class);
    }

    public function isDraft(): bool
    {
        return $this->lifecycle_state === DeviceLifecycleState::DRAFT;
    }

    public function isRegistered(): bool
    {
        return $this->lifecycle_state === DeviceLifecycleState::REGISTERED;
    }

    public function isArchived(): bool
    {
        return $this->lifecycle_state === DeviceLifecycleState::ARCHIVED;
    }

    protected function entityTagResource(): string
    {
        return 'device';
    }
}
