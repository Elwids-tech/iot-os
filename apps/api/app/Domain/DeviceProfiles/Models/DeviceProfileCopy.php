<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A published profile version rebuilt in another organization (spec 031, research R5),
 * with the map from the source version's parameter UUIDs to the copy's.
 */
final class DeviceProfileCopy extends Model
{
    protected $table = 'device_profile_copies';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['parameter_map' => 'array'];
    }

    public function sourceArtifact(): BelongsTo
    {
        return $this->belongsTo(DeviceProfileArtifact::class, 'source_artifact_id');
    }

    public function targetProfile(): BelongsTo
    {
        return $this->belongsTo(DeviceProfile::class, 'target_profile_id');
    }

    public function targetArtifact(): BelongsTo
    {
        return $this->belongsTo(DeviceProfileArtifact::class, 'target_artifact_id');
    }
}
