<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services\Moves;

use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\DeviceProfiles\Models\DeviceProfileCopy;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceLink;
use App\Domain\Devices\Services\Pipes;
use App\Domain\Devices\Services\RetentionService;
use App\Domain\Shared\Models\Organization;
use Carbon\CarbonImmutable;

/**
 * One earlier part of a moved device's history (spec 031 US6, research R18): a
 * predecessor's readings up to the cutover it left at, for the parameter its profile had
 * before the copies, read under the organization they were recorded in and its
 * retention. Nothing is copied: Laravel decides each crossing and asks the runtime for
 * each organization separately (ADR-039).
 *
 * A device's history is its own readings plus, for each link that shares, the whole
 * history its predecessor had at the cutover, earlier moves included (ADR-041). A
 * device moved back also reads what its predecessors recorded in its organization,
 * whatever the links in between share (ADR-040). Readings recorded in the device's own
 * organization are labelled `self`, any other `source`.
 */
final class EarlierReadings
{
    /** Links walked back at most; a chain this long has nothing more to give. */
    private const MAX_HOPS = 50;

    private function __construct(
        public readonly Organization $organization,
        public readonly Device $device,
        public readonly string $parameterUuid,
        public readonly CarbonImmutable $cutover,
        public readonly int $retentionDays,
        /** `self` when recorded in the device's own organization, else `source`. */
        public readonly string $recordedIn,
        /** How many links back the device is: 1 for the predecessor. Keys a records cursor. */
        public readonly int $hops,
    ) {}

    /**
     * The earlier parts of a device's history for one of its parameters, oldest first.
     * The walk follows the links back while the parameter maps through each profile copy.
     *
     * @return list<self>
     */
    public static function for(Device $device, string $parameterUuid): array
    {
        $parts = [];
        $retention = [];
        $parameter = $parameterUuid;
        foreach (self::chain($device) as [$link, $predecessor, $hops, $read]) {
            $parameter = self::parameter($predecessor, $link->target_organization_id, $parameter);
            if ($parameter === null) {
                break;
            }
            $id = $link->source_organization_id;
            $organization = $read ? ($id === $device->organization_id ? $device->organization : Organization::find($id)) : null;
            if ($organization) {
                $retention[$id] ??= app(RetentionService::class)->effective($organization)['days'];
                $parts[] = new self($organization, $predecessor, $parameter, $link->cutover_at, $retention[$id],
                    $id === $device->organization_id ? JoinedReadings::SELF : JoinedReadings::SOURCE, $hops);
            }
        }

        return array_reverse($parts);
    }

    /**
     * Whether the device's history reaches any earlier device. The move review says so
     * when the history is shared onward.
     */
    public static function reachesEarlier(Device $device): bool
    {
        return collect(self::chain($device))->contains(fn (array $step): bool => $step[3]);
    }

    /**
     * The device's chain of links, newest first: each link, its predecessor, how many
     * links back that is, and whether the device reads it. A predecessor is read when the
     * device after it is read and their link shares, or when a device of its organization
     * is read later in the chain (ADR-040, ADR-041). Stopping a link or leaving the account
     * ends what crossed it, for every device after it.
     *
     * @return list<array{0: DeviceLink, 1: Device, 2: int, 3: bool}>
     */
    private static function chain(Device $device): array
    {
        $steps = [];
        // Organizations whose device in the chain is read, and whether the device after the link is.
        $reached = [$device->organization_id => true];
        $after = true;
        // The organization of the device each link led to: a chain only continues through it.
        $organizationId = $device->organization_id;
        $seen = [$device->id => true];
        $link = $device->movedFrom;
        for ($hops = 1; $link && $link->target_organization_id === $organizationId && $hops <= self::MAX_HOPS; $hops++) {
            $predecessor = Device::find($link->predecessor_device_id);
            if (! $predecessor || isset($seen[$predecessor->id])) {
                break;
            }
            $seen[$predecessor->id] = true;
            $read = ($after && self::shared($link)) || isset($reached[$link->source_organization_id]);
            if ($read) {
                $reached[$link->source_organization_id] = true;
            }
            $steps[] = [$link, $predecessor, $hops, $read];
            $after = $read;
            $organizationId = $link->source_organization_id;
            $link = $predecessor->movedFrom;
        }

        return $steps;
    }

    /**
     * Whether the device, or one before it, was in the organization: moved there, it
     * reconnects to the readings recorded there (ADR-040). The move review says so.
     */
    public static function returnsTo(Device $device, Organization $organization): bool
    {
        $seen = [$device->id => true];
        $link = $device->movedFrom;
        for ($hops = 1; $link && $hops <= self::MAX_HOPS; $hops++) {
            if ($link->source_organization_id === $organization->id) {
                return true;
            }
            if (isset($seen[$link->predecessor_device_id])) {
                return false;
            }
            $seen[$link->predecessor_device_id] = true;
            $link = DeviceLink::where('successor_device_id', $link->predecessor_device_id)->first();
        }

        return false;
    }

    /**
     * Whether a link shares its predecessor's readings: the mover chose it, nobody stopped
     * it, and both organizations are still in one billing account.
     */
    private static function shared(DeviceLink $link): bool
    {
        return $link->history_included && $link->history_stopped_at === null
            && Pipes::sameAccount($link->source_organization_id, $link->target_organization_id);
    }

    /**
     * The predecessor's parameter the copied profile's parameter came from. Later copies
     * of the same source profile reuse the target profile, so the newest map wins.
     */
    private static function parameter(Device $predecessor, int $targetOrganizationId, string $parameterUuid): ?string
    {
        $artifact = MovePreview::baseDraft($predecessor)['artifact_uuid'] ?? null;
        $profile = $artifact ? DeviceProfileArtifact::where('uuid', $artifact)->value('device_profile_id') : null;
        if (! $profile) {
            return null;
        }
        foreach (DeviceProfileCopy::where('source_profile_id', $profile)->where('target_organization_id', $targetOrganizationId)->latest('id')->pluck('parameter_map') as $map) {
            $source = array_search($parameterUuid, $map ?? [], true);
            if (is_string($source)) {
                return $source;
            }
        }

        return null;
    }

    /**
     * The part of a requested range this predecessor answers: from the start of the
     * range, or of its retention, to the cutover. Null when that is empty.
     *
     * @param  array{from: string, to: string}  $values
     * @return ?array{from: CarbonImmutable, to: CarbonImmutable}
     */
    public function window(array $values): ?array
    {
        $now = CarbonImmutable::now();
        $from = CarbonImmutable::parse($values['from'])->max($now->subDays($this->retentionDays));
        $to = CarbonImmutable::parse($values['to'])->min($now)->min($this->cutover);

        return $to->greaterThan($from) ? ['from' => $from, 'to' => $to] : null;
    }

    /**
     * The runtime query for the predecessor: the requested range ended at the cutover,
     * under its organization, retention and parameter.
     *
     * @param  array<string, mixed>  $values  the successor's validated query
     * @return array<string, mixed>
     */
    public function query(array $values): array
    {
        return [...$values, 'to' => CarbonImmutable::parse($values['to'])->min($this->cutover)->toJSON(),
            'organization_uuid' => $this->organization->uuid, 'device_uuid' => $this->device->uuid,
            'parameter_uuid' => $this->parameterUuid, 'retention_days' => $this->retentionDays];
    }

    /**
     * One bucket width for every read of an aggregate history, as the runtime would pick
     * it for the joined range, so the answers share bucket edges.
     *
     * @param  list<self>  $parts
     * @param  array{from: string, to: string, max_points?: int}  $values
     */
    public static function bucketSeconds(array $parts, array $values, int $ownRetentionDays): int
    {
        $now = CarbonImmutable::now();
        $from = CarbonImmutable::parse($values['from'])->max($now->subDays($ownRetentionDays));
        foreach ($parts as $part) {
            $window = $part->window($values);
            $from = $window ? $from->min($window['from']) : $from;
        }
        $to = CarbonImmutable::parse($values['to'])->min($now);
        $buckets = intdiv((int) ($values['max_points'] ?? 500), 2);

        return max(1, (int) ceil(($to->getTimestampMs() - $from->getTimestampMs()) / 1000 / $buckets));
    }
}
