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
            'display_config.max' => ['sometimes', 'numeric'],
            'display_config.widget' => ['sometimes', 'string', 'max:255'],
            'display_config.options' => ['sometimes', 'array'],
            // Labels and tones for enum and boolean values, used by state cards, timelines and tables.
            'display_config.states' => ['sometimes', 'array', 'max:64'],
            'display_config.states.*' => ['array:value,label,tone'],
            'display_config.states.*.value' => ['present'],
            'display_config.states.*.label' => ['required', 'string', 'max:64'],
            'display_config.states.*.tone' => ['sometimes', 'nullable', 'in:good,info,warning,critical,muted'],
            // Preferred chart aggregation; increase (consumption) is for counters.
            'display_config.aggregation' => ['sometimes', 'in:avg,min,max,last,sum,increase'],
            'display_config.visualization' => ['sometimes', 'in:stat,gauge,meter,timeseries,consumption,state,state_timeline,table,map,color,control'],
            'reporting_config.stale_after_seconds' => ['sometimes', 'integer', 'min:1'],
            'counter_config.monotonic' => ['sometimes', 'boolean'],
            // A decrease always starts a new counter segment; diagnose also flags it for review.
            'counter_config.reset_behavior' => ['sometimes', 'string', 'in:new_segment,diagnose'],
            'counter_config.rollover_at' => ['sometimes', 'nullable', 'numeric', 'gt:0'],
        ]);
        $validator->after(function ($validator) use ($attributes): void {
            $dataType = $attributes['data_type'] ?? null;
            if ($dataType instanceof ProfileParameterDataType) {
                $dataType = $dataType->value;
            }
            $min = $attributes['display_config']['min'] ?? null;
            $max = $attributes['display_config']['max'] ?? null;
            if (is_numeric($min) && is_numeric($max) && $max <= $min) {
                $validator->errors()->add('display_config.max', 'The display range must end above where it starts.');
            }
            $kind = $attributes['kind'] ?? null;
            $kind = $kind instanceof \BackedEnum ? $kind->value : $kind;
            if (($attributes['display_config']['aggregation'] ?? null) === 'increase' && $kind !== null && $kind !== 'counter') {
                $validator->errors()->add('display_config.aggregation', 'Consumption applies to counter parameters.');
            }
            $states = $attributes['display_config']['states'] ?? null;
            if (is_array($states) && $dataType !== null) {
                $allowed = match ($dataType) {
                    ProfileParameterDataType::BOOLEAN->value => [true, false],
                    ProfileParameterDataType::ENUM->value => $attributes['validation_logic']['rule']['in'][1] ?? [],
                    default => null,
                };
                if ($allowed === null) {
                    $validator->errors()->add('display_config.states', 'State labels apply to boolean and enum parameters.');
                } else {
                    $values = array_map(fn ($state) => is_array($state) ? ($state['value'] ?? null) : null, $states);
                    foreach ($values as $index => $value) {
                        if (! in_array($value, $allowed, true)) {
                            $validator->errors()->add("display_config.states.$index.value", 'Label only values this parameter allows.');
                        }
                    }
                    if (count($values) !== count(array_unique(array_map('json_encode', $values)))) {
                        $validator->errors()->add('display_config.states', 'Each value can have one label.');
                    }
                }
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
