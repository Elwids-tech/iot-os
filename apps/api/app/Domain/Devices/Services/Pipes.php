<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\Devices\Data\Pipe;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceMove;
use App\Domain\Devices\Models\DiscoveryCandidate;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Collection;

/**
 * The one place that decides the hosted-device crossing (spec 031, research R2,
 * constitution III as amended by ADR-039). A source belongs to the organization of the
 * connection that announced it, which owns the pipe. A device may use another
 * organization's source only when it already holds it and both organizations are in one
 * billing account, which only a move or an onboarding into another organization arranges.
 */
final class Pipes
{
    /** The device's pipe, or null when it has no source or is directly connected (its gateway is part of it). */
    public function for(Device $device): ?Pipe
    {
        $adapter = $device->openInstallation?->candidate?->adapter;
        if ($adapter) {
            return $this->adapter($adapter, $device);
        }
        $gateway = $device->candidate?->gateway;
        if (! $gateway) {
            return null;
        }
        $group = $gateway->connection->group_id;
        if (str_starts_with($group, 'adapters-')) {
            return $gateway->adapter ? $this->adapter($gateway->adapter, $device) : null;
        }
        if (str_starts_with($group, 'onboarding-')) {
            return null;
        }

        return new Pipe('gateway', $gateway->name, $gateway->organization_id, $this->owner($gateway->organization_id, $device), self::online($gateway),
            $gateway->organization_id !== $device->organization_id, gatewayId: $gateway->id);
    }

    /**
     * The source a device's draft may name, locked: one of its own organization's, or the
     * source it already holds when that source's organization shares its billing account.
     * Anything else is 404, so nobody can probe another organization's Discovery.
     */
    public function allowsSource(Device $device, string $candidateUuid): DiscoveryCandidate
    {
        $candidate = DiscoveryCandidate::query()->where('uuid', $candidateUuid)->lockForUpdate()->firstOrFail();
        if ($candidate->organization_id === $device->organization_id) {
            return $candidate;
        }
        abort_unless($device->device_discovery_candidate_id === $candidate->id && self::sameAccount($candidate->organization_id, $device->organization_id), 404);

        return $candidate;
    }

    /**
     * The organization's devices, archived ones aside, that report through another
     * organization's pipe.
     *
     * @return Collection<int, Device>
     */
    public function hostedIn(Organization $organization): Collection
    {
        return Device::query()->where('organization_id', $organization->id)->where('lifecycle', '!=', 'archived')
            ->whereHas('candidate', fn ($query) => $query->where('organization_id', '!=', $organization->id))
            ->orderBy('name')->get(['id', 'uuid', 'name', 'organization_id', 'device_discovery_candidate_id']);
    }

    /**
     * Other organizations' devices, archived ones aside, that report through this
     * organization's pipes, grouped by organization.
     *
     * @return list<array{organization_id: int, organization_name: string, devices: Collection<int, Device>}>
     */
    public function servedBy(Organization $organization): array
    {
        $devices = Device::query()->where('organization_id', '!=', $organization->id)->where('lifecycle', '!=', 'archived')
            ->whereHas('candidate', fn ($query) => $query->where('organization_id', $organization->id))
            ->orderBy('name')->get(['id', 'uuid', 'name', 'organization_id', 'device_discovery_candidate_id']);
        $names = Organization::withTrashed()->whereIn('id', $devices->pluck('organization_id')->unique())->pluck('name', 'id');

        return $devices->groupBy('organization_id')->map(fn (Collection $group, int $id): array => [
            'organization_id' => $id, 'organization_name' => (string) $names[$id], 'devices' => $group->values(),
        ])->sortBy('organization_name')->values()->all();
    }

    /**
     * What ties the organization to others of its billing account (spec 031, FR-061): its
     * devices on other organizations' pipes, by pipe owner; other organizations' devices
     * on its pipes, by their organization; and moves still stopping, by the other side.
     *
     * @return list<array{name: string, devices: list<string>}>
     */
    public function crossings(Organization $organization): array
    {
        $byName = [];
        $hosted = $this->hostedIn($organization)->load('candidate:id,organization_id');
        $owners = Organization::withTrashed()->whereIn('id', $hosted->pluck('candidate.organization_id')->unique())->pluck('name', 'id');
        foreach ($hosted as $device) {
            $byName[(string) $owners[$device->candidate->organization_id]][] = $device->name;
        }
        foreach ($this->servedBy($organization) as $group) {
            $byName[$group['organization_name']] = [...$byName[$group['organization_name']] ?? [], ...$group['devices']->pluck('name')->all()];
        }
        $moves = DeviceMove::where('status', 'stopping')->where(fn ($query) => $query->where('source_organization_id', $organization->id)->orWhere('target_organization_id', $organization->id))->with('devices.predecessor:id,name')->get();
        foreach ($moves as $move) {
            $other = $move->source_organization_id === $organization->id ? $move->target_organization_id : $move->source_organization_id;
            $name = (string) Organization::withTrashed()->whereKey($other)->value('name');
            foreach ($move->devices as $row) {
                $byName[$name][] = $move->source_organization_id === $organization->id ? $row->predecessor->name : $row->name;
            }
        }
        ksort($byName);

        return array_map(fn (string $name, array $devices): array => ['name' => $name, 'devices' => array_values(array_unique($devices))], array_keys($byName), array_values($byName));
    }

    /** Refuses with 409, listing the devices per organization, while the organization has crossings. */
    public function ensureCanLeave(Organization $organization): void
    {
        $crossings = $this->crossings($organization);
        if ($crossings === []) {
            return;
        }
        throw new HttpResponseException(response()->json([
            'message' => $organization->name.' has devices hosted across organizations of its billing account, or a move in progress. Move or archive them before it leaves the account.',
            'hosted_devices' => ['organizations' => $crossings],
        ], 409));
    }

    /** Whether two organizations share a billing account; never for a deleted one. */
    public static function sameAccount(int $first, int $second): bool
    {
        $accounts = Organization::query()->whereIn('id', [$first, $second])->pluck('billing_account_id', 'id');

        return $accounts->count() === 2 && $accounts[$first] !== null && $accounts[$first] === $accounts[$second];
    }

    /** A gateway's presence as people see it: online only with recent runtime contact. */
    public static function online(SparkplugGateway $gateway): bool
    {
        return $gateway->presence === 'online' && $gateway->runtime_seen_at !== null && $gateway->runtime_seen_at->gte(now()->subSeconds(20));
    }

    private function adapter(DeviceAdapter $adapter, Device $device): Pipe
    {
        $online = $adapter->status === 'running' && $adapter->gateway !== null && self::online($adapter->gateway);

        return new Pipe('adapter', $adapter->name, $adapter->organization_id, $this->owner($adapter->organization_id, $device), $online,
            $adapter->organization_id !== $device->organization_id, adapterId: $adapter->id, gatewayId: $adapter->sparkplug_gateway_id);
    }

    private function owner(int $organizationId, Device $device): string
    {
        return $organizationId === $device->organization_id
            ? (string) $device->organization->name
            : (string) Organization::withTrashed()->whereKey($organizationId)->value('name');
    }
}
