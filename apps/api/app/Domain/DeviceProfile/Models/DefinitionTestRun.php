<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Models;

use App\Domain\Shared\Models\Concerns\HasPublicUuid;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'uuid',
    'organization_id',
    'device_profile_version_id',
    'transport_binding_version_id',
    'profile_revision',
    'binding_revision',
    'input_hash',
    'valid',
    'compiler',
    'diagnostics',
    'previews',
    'profile_artifact',
    'binding_artifact',
    'profile_artifact_hash',
    'binding_artifact_hash',
    'completed_at',
    'created_by_id',
])]
final class DefinitionTestRun extends Model
{
    use HasPublicUuid;

    protected function casts(): array
    {
        return [
            'profile_revision' => 'integer',
            'binding_revision' => 'integer',
            'valid' => 'boolean',
            'compiler' => 'array',
            'diagnostics' => 'array',
            'previews' => 'array',
            'profile_artifact' => 'array',
            'binding_artifact' => 'array',
            'completed_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<Organization, $this> */
    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
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
}
