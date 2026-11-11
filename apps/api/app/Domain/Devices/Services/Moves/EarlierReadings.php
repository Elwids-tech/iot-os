<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services\Moves;

use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\DeviceProfiles\Models\DeviceProfileCopy;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Services\Pipes;
use App\Domain\Devices\Services\RetentionService;
use App\Domain\Shared\Models\Organization;
use Carbon\CarbonImmutable;

/**
 * What a moved device reads of its predecessor (spec 031 US6, research R18): the
 * predecessor's readings under the source organization, with the source's retention,
 * up to the cutover, for the parameter it had before its profile was copied. Laravel
 * decides the crossing and asks the runtime for each organization separately; nothing
 * is copied (ADR-039).
 */
final class EarlierReadings
{
    private function __construct(
        public readonly Organization $organization,
        public readonly Device $device,
        public readonly string $parameterUuid,
        public readonly CarbonImmutable $cutover,
        public readonly int $retentionDays,
    ) {}

    /**
     * The predecessor's side of a successor's parameter, or null. Only while the mover
     * shared history, nobody stopped it, both organizations are in one billing account,
     * and the parameter existed before the move. Only the device's own link counts:
     * history never follows a chain of moves.
     */
    public static function for(Device $device, string $parameterUuid): ?self
    {
        $link = $device->movedFrom;
        if (! $link || ! $link->history_included || $link->history_stopped_at !== null || $link->target_organization_id !== $device->organization_id
            || ! Pipes::sameAccount($link->source_organization_id, $link->target_organization_id)) {
            return null;
        }
        $predecessor = Device::find($link->predecessor_device_id);
        $source = Organization::find($link->source_organization_id);
        $parameter = $predecessor ? self::parameter($predecessor, $link->target_organization_id, $parameterUuid) : null;
        if (! $source || ! $parameter) {
            return null;
        }

        return new self($source, $predecessor, $parameter, $link->cutover_at, app(RetentionService::class)->effective($source)['days']);
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
     * The part of a requested range the predecessor answers: from the start of the range,
     * or of the source's retention, to the cutover. Null when that is empty.
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
     * under the source, its retention and the predecessor's parameter.
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
     * One bucket width for both reads of an aggregate history, as the runtime would pick
     * it for the joined range, so the two answers share bucket edges.
     *
     * @param  array{from: string, to: string, max_points?: int}  $values
     */
    public function bucketSeconds(array $values, int $ownRetentionDays): int
    {
        $now = CarbonImmutable::now();
        $earlier = $this->window($values);
        $from = CarbonImmutable::parse($values['from'])->max($now->subDays($ownRetentionDays));
        $from = $earlier ? $from->min($earlier['from']) : $from;
        $to = CarbonImmutable::parse($values['to'])->min($now);
        $buckets = intdiv((int) ($values['max_points'] ?? 500), 2);

        return max(1, (int) ceil(($to->getTimestampMs() - $from->getTimestampMs()) / 1000 / $buckets));
    }
}
