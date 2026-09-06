<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Services;

use Illuminate\Support\Facades\Validator;

final class ProfileConfigurationValidator
{
    /** Validate only recognized fields; unknown extension keys remain untouched. */
    public function errors(array $attributes): array
    {
        return Validator::make($attributes, [
            'display_config.precision' => ['sometimes', 'integer', 'between:0,15'],
            'display_config.step' => ['sometimes', 'numeric', 'gt:0'],
            'display_config.widget' => ['sometimes', 'string', 'max:255'],
            'display_config.options' => ['sometimes', 'array'],
            'reporting_config.stale_after_seconds' => ['sometimes', 'integer', 'min:1'],
            'counter_config.monotonic' => ['sometimes', 'boolean'],
            'counter_config.reset_behavior' => ['sometimes', 'string', 'max:255'],
        ])->errors()->messages();
    }
}
