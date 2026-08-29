<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Models;

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
    'key',
    'name',
    'description',
    'mqtt_client_id',
    'revision',
    'created_by_id',
    'updated_by_id',
])]
final class Gateway extends Model
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

    /** @return BelongsTo<User, $this> */
    public function updatedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by_id');
    }

    /** @return HasMany<GatewayRoute, $this> */
    public function routes(): HasMany
    {
        return $this->hasMany(GatewayRoute::class);
    }

    protected function entityTagResource(): string
    {
        return 'gateway';
    }
}
