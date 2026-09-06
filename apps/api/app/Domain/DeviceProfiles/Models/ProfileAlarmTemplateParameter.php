<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

final class ProfileAlarmTemplateParameter extends Model
{
    protected $guarded = [];

    public function template(): BelongsTo
    {
        return $this->belongsTo(ProfileAlarmTemplate::class, 'profile_alarm_template_id');
    }

    public function parameter(): BelongsTo
    {
        return $this->belongsTo(ProfileParameter::class, 'profile_parameter_id');
    }
}
