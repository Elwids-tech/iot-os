<?php

declare(strict_types=1);

namespace App\Domain\Entities\Services;

use App\Domain\Devices\Models\Device;

/**
 * A device's parameters as its current profile revision defines them: the applied
 * configuration's, else the last one the runtime confirmed (the rule telemetry reads
 * use). A device with neither has none yet; its points appear once it has one.
 */
final class DeviceParameters
{
    /**
     * @return array<string, array{uuid: string, key: string, label: string, unit: ?string}> by parameter UUID
     */
    public static function of(Device $device): array
    {
        $configuration = $device->appliedConfiguration ?? $device->lastAppliedConfiguration;
        $canonical = $configuration?->definition['profile_canonical_json'] ?? null;
        $profile = is_string($canonical) ? json_decode($canonical, true) : $canonical;
        $parameters = [];
        foreach (is_array($profile) ? ($profile['parameters'] ?? []) : [] as $parameter) {
            if (isset($parameter['uuid'], $parameter['key'])) {
                $parameters[(string) $parameter['uuid']] = ['uuid' => (string) $parameter['uuid'], 'key' => (string) $parameter['key'],
                    'label' => (string) ($parameter['label'] ?? $parameter['key']), 'unit' => $parameter['unit'] ?? null];
            }
        }

        return $parameters;
    }
}
