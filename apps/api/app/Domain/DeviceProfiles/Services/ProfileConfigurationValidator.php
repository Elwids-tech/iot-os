<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Services;

use App\Domain\DeviceProfiles\Enums\ProfileParameterDataType;
use Illuminate\Support\Facades\Validator;

final class ProfileConfigurationValidator
{
    /** Validate only recognized fields; unknown extension keys remain untouched. */
    public function errors(array $attributes): array
    {
        $validator = Validator::make($attributes, [
            'display_config.precision' => ['sometimes', 'integer', 'between:0,15'],
            'display_config.step' => ['sometimes', 'numeric', 'gt:0'],
            'display_config.min' => ['sometimes', 'numeric'],
            'display_config.max' => ['sometimes', 'numeric', 'gt:display_config.min'],
            'display_config.widget' => ['sometimes', 'string', 'max:255'],
            'display_config.options' => ['sometimes', 'array'],
            'reporting_config.stale_after_seconds' => ['sometimes', 'integer', 'min:1'],
            'counter_config.monotonic' => ['sometimes', 'boolean'],
            'counter_config.reset_behavior' => ['sometimes', 'string', 'max:255'],
        ]);
        $validator->after(function ($validator) use ($attributes): void {
            $dataType = $attributes['data_type'] ?? null;
            if ($dataType instanceof ProfileParameterDataType) {
                $dataType = $dataType->value;
            }
            if ($dataType !== ProfileParameterDataType::ENUM->value) {
                return;
            }

            $membership = $attributes['validation_logic']['rule']['in'] ?? null;
            $options = is_array($membership) && count($membership) === 2
                && ($membership[0] ?? null) === ['var' => 'value']
                && is_array($membership[1] ?? null)
                ? $membership[1]
                : [];
            $valid = $options !== [] && array_is_list($options)
                && count(array_filter($options, 'is_string')) === count($options)
                && count(array_unique($options)) === count($options);
            if (! $valid) {
                $validator->errors()->add('validation_logic', 'Enum parameters need one or more unique string values under Allowed values.');
            }
        });

        return $validator->errors()->messages();
    }
}
