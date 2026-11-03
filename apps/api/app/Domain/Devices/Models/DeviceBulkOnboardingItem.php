<?php

declare(strict_types=1);

namespace App\Domain\Devices\Models;

use App\Domain\Devices\Enums\BulkOnboardingItemStatus;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One selected source of a bulk onboarding run. Items have no UUID of their own. */
final class DeviceBulkOnboardingItem extends Model
{
    protected $table = 'device_bulk_onboarding_items';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['status' => BulkOnboardingItemStatus::class, 'attempts' => 'integer'];
    }

    public function run(): BelongsTo
    {
        return $this->belongsTo(DeviceBulkOnboarding::class, 'device_bulk_onboarding_id');
    }

    public function candidate(): BelongsTo
    {
        return $this->belongsTo(DiscoveryCandidate::class, 'discovery_candidate_id');
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }
}
