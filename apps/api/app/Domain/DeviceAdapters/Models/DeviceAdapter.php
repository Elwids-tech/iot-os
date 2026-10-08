<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Models;

use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\Devices\Models\DeviceModel;
use App\Domain\Devices\Models\SparkplugGateway;

final class DeviceAdapter extends DeviceModel
{
    protected $hidden = ['secrets'];

    protected function casts(): array
    {
        return ['fixtures' => 'array', 'source' => 'array', 'secrets' => 'encrypted:array', 'health' => 'array', 'draft_revision' => 'integer'];
    }

    public function artifact()
    {
        return $this->belongsTo(DeviceProfileArtifact::class, 'device_profile_artifact_id');
    }

    public function gateway()
    {
        return $this->belongsTo(SparkplugGateway::class, 'sparkplug_gateway_id');
    }

    public function revisions()
    {
        return $this->hasMany(AdapterRevision::class);
    }

    public function candidates()
    {
        return $this->hasMany(AdapterCandidate::class);
    }
}
