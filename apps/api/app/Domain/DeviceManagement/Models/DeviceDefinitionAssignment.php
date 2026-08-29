<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Models;

use App\Domain\DeviceManagement\Enums\AssignmentCompatibilityState;
use App\Domain\DeviceProfile\Models\DeviceProfileVersion;
use App\Domain\DeviceProfile\Models\TransportBindingVersion;
use App\Domain\Shared\Models\Concerns\HasPublicUuid;
use App\Domain\Shared\Models\Concerns\HasRevisionEntityTag;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'uuid',
    'organization_id',
    'device_id',
    'device_profile_version_id',
    'transport_binding_version_id',
    'gateway_route_id',
    'compatibility_state',
    'profile_artifact_hash',
    'binding_artifact_hash',
    'route_source_hash',
    'runtime_bundle_hash',
    'runtime_bundle',
    'runtime_compiled_at',
    'revision',
    'locked_at',
    'created_by_id',
    'updated_by_id',
])]
final class DeviceDefinitionAssignment extends Model
{
    use HasPublicUuid;
    use HasRevisionEntityTag;

    protected $attributes = [
        'revision' => 1,
        'compatibility_state' => 'v1_unmigrated',
    ];

    protected function casts(): array
    {
        return [
            'revision' => 'integer',
            'compatibility_state' => AssignmentCompatibilityState::class,
            'runtime_bundle' => 'array',
            'runtime_compiled_at' => 'immutable_datetime',
            'locked_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<Organization, $this> */
    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
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

    /** @return BelongsTo<GatewayRoute, $this> */
    public function gatewayRoute(): BelongsTo
    {
        return $this->belongsTo(GatewayRoute::class);
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

    public function isLocked(): bool
    {
        return $this->locked_at !== null;
    }

    public function isRouteAwareV2(): bool
    {
        return $this->compatibility_state === AssignmentCompatibilityState::V2_ROUTE_AWARE;
    }

    protected function entityTagResource(): string
    {
        return 'definition-assignment';
    }
}
