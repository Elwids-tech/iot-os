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
 * before the copies. A device has two kinds:
 *
 * - its own predecessor's, while the mover shared them: read under the source
 *   organization and its retention, labelled `source`. Laravel decides that crossing and
 *   asks the runtime for each organization separately; nothing is copied (ADR-039).
 * - those of any earlier predecessor in its own organization, which a device moved back
 *   recorded there before (ADR-040): read under the device's organization and retention,
 *   labelled `self`, whatever the links in between share. That crosses nothing.
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
        /** `source` for the predecessor's shared readings, `self` for the device's own organization's. */
        public readonly string $recordedIn,
        /** How many links back the device is: 1 for the predecessor. Keys a records cursor. */
        public readonly int $hops,
    ) {}

    /**
     * The earlier parts of a device's history for one of its parameters, oldest first:
     * its organization's earlier predecessors, then its predecessor's readings when its
     * link shares them. The walk follows the links back while the parameter maps through
     * each profile copy.
     *
     * @return list<self>
     */
    public static function for(Device $device, string $parameterUuid): array
    {
        $parts = [];
        $own = null;
        $parameter = $parameterUuid;
        // The organization of the device each link led to: a chain only continues through it.
        $organizationId = $device->organization_id;
        $seen = [$device->id => true];
        $link = $device->movedFrom;
        for ($hops = 1; $link && $link->target_organization_id === $organizationId && $hops <= self::MAX_HOPS; $hops++) {
            $predecessor = Device::find($link->predecessor_device_id);
            $parameter = $predecessor && ! isset($seen[$predecessor->id]) ? self::parameter($predecessor, $link->target_organization_id, $parameter) : null;
            if ($parameter === null) {
                break;
            }
            $seen[$predecessor->id] = true;
            if ($link->source_organization_id === $device->organization_id) {
                $own ??= app(RetentionService::class)->effective($device->organization)['days'];
                $parts[] = new self($device->organization, $predecessor, $parameter, $link->cutover_at, $own, JoinedReadings::SELF, $hops);
            } elseif ($hops === 1 && self::shared($link) && ($source = Organization::find($link->source_organization_id))) {
                $parts[] = new self($source, $predecessor, $parameter, $link->cutover_at, app(RetentionService::class)->effective($source)['days'], JoinedReadings::SOURCE, $hops);
            }
            $organizationId = $link->source_organization_id;
            $link = $predecessor->movedFrom;
        }

        return array_reverse($parts);
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
