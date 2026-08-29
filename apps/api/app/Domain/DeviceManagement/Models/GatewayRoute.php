<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Models;

use App\Domain\DeviceProfile\Models\DeviceProfileVersion;
use App\Domain\DeviceProfile\Models\TransportBindingVersion;
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
    'gateway_id',
    'device_id',
    'device_profile_version_id',
    'transport_binding_version_id',
    'revision',
    'route_path',
    'topic_variables',
    'inbound_scopes',
    'enabled',
    'created_by_id',
    'updated_by_id',
])]
final class GatewayRoute extends Model
{
    use HasPublicUuid;
    use HasRevisionEntityTag;

    protected $attributes = [
        'revision' => 1,
        'enabled' => true,
    ];

    protected function casts(): array
    {
        return [
            'revision' => 'integer',
            'topic_variables' => 'array',
            'inbound_scopes' => 'array',
            'enabled' => 'boolean',
        ];
    }

    /** @return BelongsTo<Organization, $this> */
    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    /** @return BelongsTo<Gateway, $this> */
    public function gateway(): BelongsTo
    {
        return $this->belongsTo(Gateway::class);
    }

    /** @return BelongsTo<Device, $this> */
    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }

    /** @return BelongsTo<DeviceProfileVersion, $this> */
    public function profileVersion(): BelongsTo
    {
        return $this->belongsTo(DeviceProfileVersion::class, 'device_profile_version_id');
    }

    /** @return BelongsTo<TransportBindingVersion, $this> */
    public function bindingVersion(): BelongsTo
    {
        return $this->belongsTo(TransportBindingVersion::class, 'transport_binding_version_id');
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

    /** @return HasOne<DeviceDefinitionAssignment, $this> */
    public function definitionAssignment(): HasOne
    {
        return $this->hasOne(DeviceDefinitionAssignment::class);
    }

    protected function entityTagResource(): string
    {
        return 'gateway-route';
    }
}
