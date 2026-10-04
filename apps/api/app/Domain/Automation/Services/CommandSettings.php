<?php

declare(strict_types=1);

namespace App\Domain\Automation\Services;

final class CommandSettings
{
    /** One immutable command configuration per selected setting; legacy nodes stay unchanged. */
    public static function configurations(array $config): array
    {
        if (! array_key_exists('settings', $config)) {
            return [$config];
        }
        abort_unless(is_array($config['settings']) && count($config['settings']) >= 1 && count($config['settings']) <= 32 && ! array_key_exists('binding', $config) && ! array_key_exists('value', $config), 422, 'Select 1–32 settings without legacy binding/value fields.');
        $settings = $config['settings'];
        ksort($settings);
        $commands = [];
        foreach ($settings as $binding => $value) {
            $commands[] = ['binding' => $binding, 'value' => $value, 'cooldown_seconds' => $config['cooldown_seconds'] ?? null, 'ttl_seconds' => $config['ttl_seconds'] ?? null];
        }
        return $commands;
    }
}
