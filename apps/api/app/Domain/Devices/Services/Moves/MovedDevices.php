<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services\Moves;

use App\Domain\Devices\Models\DeviceLink;
use App\Domain\Shared\Models\Organization;

/**
 * Which of an organization's devices moved elsewhere (spec 031 FR-034, FR-036): the
 * archived predecessors that dashboards and automations kept in the source still name,
 * with the organization each went to. It names the target and nothing else of it.
 */
final class MovedDevices
{
    /**
     * @param  list<string>  $uuids
     * @return array<string, array{device_uuid: string, name: string, organization_name: ?string, cutover_at: string}> by device UUID
     */
    public static function among(int $organizationId, array $uuids): array
    {
        if ($uuids === []) {
            return [];
        }
        $links = DeviceLink::where('source_organization_id', $organizationId)
            ->whereHas('predecessor', fn ($query) => $query->where('organization_id', $organizationId)->whereIn('uuid', array_values(array_unique($uuids))))
            ->with('predecessor:id,uuid,name')->get();
        $names = Organization::withTrashed()->whereIn('id', $links->pluck('target_organization_id')->unique())->pluck('name', 'id');

        return $links->mapWithKeys(fn (DeviceLink $link): array => [$link->predecessor->uuid => [
            'device_uuid' => $link->predecessor->uuid, 'name' => $link->predecessor->name,
            'organization_name' => $names[$link->target_organization_id] ?? null, 'cutover_at' => $link->cutover_at->toJSON(),
        ]])->all();
    }
}
