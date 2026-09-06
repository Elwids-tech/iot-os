<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Models;

use App\Domain\DeviceProfiles\Enums\ProfileParameterDataType;
use App\Domain\DeviceProfiles\Enums\ProfileParameterKind;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Support\Str;

final class ProfileParameter extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'kind' => ProfileParameterKind::class,
            'data_type' => ProfileParameterDataType::class,
            'reports_state' => 'boolean',
            'accepts_command' => 'boolean',
            'validation_logic' => 'array',
            'display_config' => 'array',
            'reporting_config' => 'array',
            'counter_config' => 'array',
        ];
    }

    protected static function booted(): void
    {
        self::creating(function (self $parameter): void {
            $parameter->uuid ??= (string) Str::uuid();
        });
    }

    public function getRouteKeyName(): string
    {
        return 'uuid';
    }

    public function profile(): BelongsTo
    {
        return $this->belongsTo(DeviceProfile::class, 'device_profile_id');
    }

    public function group(): BelongsTo
    {
        return $this->belongsTo(ProfileParameterGroup::class, 'parameter_group_id');
    }

    public function calculation(): HasOne
    {
        return $this->hasOne(ProfileCalculation::class, 'target_profile_parameter_id');
    }

    public function calculationInputs(): HasMany
    {
        return $this->hasMany(ProfileCalculationInput::class, 'profile_parameter_id');
    }

    public function alarmTemplateParameters(): HasMany
    {
        return $this->hasMany(ProfileAlarmTemplateParameter::class, 'profile_parameter_id');
    }

    public function bindingMappings(): HasMany
    {
        return $this->hasMany(BindingParameterMapping::class, 'profile_parameter_id');
    }
}
