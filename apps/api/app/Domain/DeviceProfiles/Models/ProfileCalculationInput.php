<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

final class ProfileCalculationInput extends Model
{
    protected $guarded = [];

    public function calculation(): BelongsTo
    {
        return $this->belongsTo(ProfileCalculation::class, 'profile_calculation_id');
    }

    public function parameter(): BelongsTo
    {
        return $this->belongsTo(ProfileParameter::class, 'profile_parameter_id');
    }
}
