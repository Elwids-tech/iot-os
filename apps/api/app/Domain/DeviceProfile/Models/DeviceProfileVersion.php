<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Models;

use App\Domain\DeviceManagement\Models\GatewayRoute;
use App\Domain\DeviceProfile\Enums\DefinitionState;
use App\Domain\Shared\Models\Concerns\HasPublicUuid;
use App\Domain\Shared\Models\Concerns\HasRevisionEntityTag;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'uuid',
    'organization_id',
    'device_profile_id',
    'version',
    'state',
    'definition',
    'revision',
    'artifact',
    'artifact_hash',
    'source_hash',
    'compiler',
    'published_at',
    'retired_at',
    'created_by_id',
])]
final class DeviceProfileVersion extends Model
{
    use HasPublicUuid;
    use HasRevisionEntityTag;

    protected $attributes = [
        'state' => 'draft',
        'revision' => 1,
    ];

    protected function casts(): array
    {
        return [
            'version' => 'integer',
            'state' => DefinitionState::class,
            'definition' => 'array',
            'revision' => 'integer',
            'artifact' => 'array',
            'compiler' => 'array',
            'published_at' => 'immutable_datetime',
            'retired_at' => 'immutable_datetime',
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

    /** @return BelongsTo<User, $this> */
    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by_id');
    }

    /** @return HasMany<GatewayRoute, $this> */
    public function gatewayRoutes(): HasMany
    {
        return $this->hasMany(GatewayRoute::class);
    }

    public function isDraft(): bool
    {
        return $this->state === DefinitionState::DRAFT;
    }

    public function isPublished(): bool
    {
        return $this->state === DefinitionState::PUBLISHED;
    }

    protected function entityTagResource(): string
    {
        return 'profile-version';
    }
}
