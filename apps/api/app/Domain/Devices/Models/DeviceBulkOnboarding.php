<?php

declare(strict_types=1);

namespace App\Domain\Devices\Models;

use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\Devices\Enums\BulkOnboardingStatus;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** One bulk onboarding run; its uuid is the request's `operation_uuid` (spec 026 US5). */
final class DeviceBulkOnboarding extends DeviceModel
{
    protected $table = 'device_bulk_onboardings';

    protected function casts(): array
    {
        return ['status' => BulkOnboardingStatus::class, 'created_by' => 'integer', 'started_at' => 'immutable_datetime', 'finished_at' => 'immutable_datetime'];
    }

    public function gateway(): BelongsTo
    {
        return $this->belongsTo(SparkplugGateway::class, 'sparkplug_gateway_id');
    }

    public function artifact(): BelongsTo
    {
        return $this->belongsTo(DeviceProfileArtifact::class, 'device_profile_artifact_id');
    }

    public function items(): HasMany
    {
        return $this->hasMany(DeviceBulkOnboardingItem::class);
    }
}
