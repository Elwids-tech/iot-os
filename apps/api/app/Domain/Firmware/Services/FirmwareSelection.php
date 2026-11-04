<?php

declare(strict_types=1);

namespace App\Domain\Firmware\Services;

use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Services\DeviceProfileAuthorization;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;

/**
 * A gateway's saved firmware choices (spec 027 data model, FR-042): written by downloads
 * from the gateway, read so teammates see the same choices. Stores profile UUIDs, so the
 * next download offers each profile's newest published revision.
 */
final class FirmwareSelection
{
    public function __construct(private readonly DeviceProfileAuthorization $authorization) {}

    /**
     * @param  array{profile_uuid: string}|null  $node  null for the SDK's default health table
     * @param  list<array{profile_uuid: string}>  $types
     */
    public function save(SparkplugGateway $gateway, string $target, ?array $node, array $types, User $user): void
    {
        $gateway->forceFill(['firmware_selection' => [
            'format' => 1,
            'target' => $target,
            'node_profile_uuid' => $node['profile_uuid'] ?? null,
            'device_profile_uuids' => array_column($types, 'profile_uuid'),
            'saved_by_user_id' => $user->id,
            'saved_at' => now()->utc()->format('Y-m-d\TH:i:s\Z'),
        ]])->save();
    }

    /**
     * Saved selections as the gateways list shows them, without profiles that were deleted
     * or that this person may not view.
     *
     * @return callable(SparkplugGateway): ?array
     */
    public function viewer(Organization $organization, User $user): callable
    {
        $canView = null;
        $exists = [];

        return function (SparkplugGateway $gateway) use ($organization, $user, &$canView, &$exists): ?array {
            $saved = $gateway->firmware_selection;
            if (! is_array($saved) || ($saved['format'] ?? null) !== 1) {
                return null;
            }
            $canView ??= (bool) $this->authorization->capabilities($user, $organization)['view'];
            $visible = function (?string $uuid) use ($organization, $canView, &$exists): bool {
                if ($uuid === null || ! $canView) {
                    return false;
                }

                return $exists[$uuid] ??= DeviceProfile::where('uuid', $uuid)->where('organization_id', $organization->id)->exists();
            };

            return [
                'target' => $saved['target'],
                'node_profile_uuid' => $visible($saved['node_profile_uuid'] ?? null) ? $saved['node_profile_uuid'] : null,
                'device_profile_uuids' => array_values(array_filter($saved['device_profile_uuids'] ?? [], $visible)),
            ];
        };
    }
}
