<?php

declare(strict_types=1);

namespace App\Domain\Automation\Services;

use App\Domain\Devices\Models\Device;

/**
 * Says what a runtime activation diagnostic or suspension reason means for the person
 * who can fix it. The runtime reports `device_review_required: <role>` when a bound
 * device's source needs review (ADR-025), and `binding_changed: <role>` when the bound
 * configuration is no longer the applied one.
 */
final class DagDiagnostic
{
    public const REVIEW = 'device_review_required';

    /** The `stopped_reason` recorded for a runtime suspension reason. */
    public static function stoppedReason(string $reason): string
    {
        return str_starts_with($reason, self::REVIEW) ? self::REVIEW : 'binding_changed';
    }

    /** The device UUID a description of $reason names, if any. */
    public static function device(?string $reason, array $graph): ?string
    {
        if ($reason === null || ! str_starts_with($reason, self::REVIEW)) {
            return null;
        }
        $role = trim(substr($reason, strlen(self::REVIEW)), ': ');

        return collect($graph['bindings'] ?? [])->firstWhere('role', $role)['device_uuid'] ?? null;
    }

    /**
     * @param  array<string, string>  $deviceNames  names by device UUID
     * @param  bool  $brief  the shorter form for the automation list
     */
    public static function describe(?string $reason, array $graph, array $deviceNames, bool $brief = false): ?string
    {
        if ($reason === null || ! str_starts_with($reason, self::REVIEW)) {
            return $reason;
        }
        $name = $deviceNames[self::device($reason, $graph) ?? ''] ?? null;
        $subject = $name === null ? 'A bound device' : "Device \"{$name}\"";

        return $brief
            ? $subject.' needs review: its source no longer announces its approved metrics. Activate again once it does or the device is reactivated.'
            : $subject.' needs review because its source stopped announcing the metrics its configuration was approved for.'
                .' Review clears when the source announces them again or when you activate the device’s configuration.'
                .' Then activate this automation again.';
    }

    /** describe() for one workflow, looking up the device name only when the reason needs it. */
    public static function forWorkflow(?string $reason, array $graph, int $organizationId): ?string
    {
        $device = self::device($reason, $graph);
        $names = $device === null ? [] : Device::where('organization_id', $organizationId)->where('uuid', $device)->pluck('name', 'uuid')->all();

        return self::describe($reason, $graph, $names);
    }
}
