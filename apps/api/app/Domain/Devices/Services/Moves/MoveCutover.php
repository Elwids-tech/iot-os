<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services\Moves;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Automation\Models\Alert;
use App\Domain\Billing\Services\DeviceLimit;
use App\Domain\DeviceAdapters\Models\AdapterCandidate;
use App\Domain\DeviceAdapters\Models\DeviceInstallation;
use App\Domain\DeviceAdapters\Services\AdapterService;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\DeviceProfiles\Models\DeviceProfileCopy;
use App\Domain\DeviceProfiles\Services\ProfileCopier;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceLink;
use App\Domain\Devices\Models\DeviceMove;
use App\Domain\Devices\Models\DeviceMoveDevice;
use App\Domain\Devices\Models\DeviceOnboarding;
use App\Domain\Devices\Models\Site;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Devices\Services\DeviceConfigurationService;
use App\Domain\Devices\Services\Pipes;
use App\Domain\Devices\Services\RuntimeClient;
use App\Domain\Geospatial\Services\GeofenceService;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Throwable;

/**
 * The cutover (spec 031 FR-007, research R1, R4, R6, R7): one transaction, once every
 * predecessor has stopped. It archives each predecessor as moved, creates its successor
 * in the target from the predecessor's last applied configuration rewritten onto a copy
 * of its profile version, hands over the device-limit place, links the two, and ends
 * what does not move. Pipes stay: an adapter-fed successor gets a new installation on
 * the same adapter source, and each adapter is redeployed once after commit; a successor
 * behind a gateway takes the same gateway source and activates against its live birth.
 * Dashboards and automations are moved, copied, kept or archived as confirmed
 * (CarriedItems).
 */
final class MoveCutover
{
    public function __construct(
        private readonly DeviceAuthorization $authorization,
        private readonly DeviceConfigurationService $configuration,
        private readonly ProfileCopier $copier,
        private readonly DeviceLimit $limit,
        private readonly MoveFailure $failure,
        private readonly CarriedItems $items,
    ) {}

    /** Returns without a change unless the move is stopping and every device has stopped. */
    public function run(DeviceMove $move): void
    {
        DB::transaction(function () use ($move): void {
            Organization::whereIn('id', [$move->source_organization_id, $move->target_organization_id])->orderBy('id')->lockForUpdate()->get();
            $move = DeviceMove::whereKey($move->id)->lockForUpdate()->firstOrFail();
            $rows = $move->devices()->get();
            if ($move->status !== 'stopping' || $rows->contains(fn (DeviceMoveDevice $row): bool => ! in_array($row->state, ['waiting', 'stopped'], true))) {
                return;
            }
            $source = Organization::find($move->source_organization_id);
            $target = Organization::find($move->target_organization_id);
            $mover = User::find($move->mover_id);
            $predecessors = Device::whereIn('id', $rows->pluck('predecessor_device_id'))->orderBy('id')->lockForUpdate()->with('lastAppliedConfiguration')->get()->keyBy('id');
            if ($reason = $this->refusal($move, $source, $target, $mover, $rows, $predecessors)) {
                $this->failure->fail($move, $reason);

                return;
            }
            $copies = $this->copies($predecessors, $source, $target, $mover);
            $activate = $this->authorization->capabilities($mover, $target)['activate'];
            $at = now();
            $adapters = [];
            $moved = [];
            $successors = [];
            foreach ($rows as $row) {
                $predecessor = $predecessors[$row->predecessor_device_id];
                [$successor, $adapter] = $this->successor($row, $predecessor, $target, $mover, $copies, $row->arrives_active && $activate);
                if ($adapter) {
                    $adapters[] = $adapter;
                }
                DeviceLink::create([
                    'predecessor_device_id' => $predecessor->id, 'successor_device_id' => $successor->id, 'source_organization_id' => $source->id,
                    'target_organization_id' => $target->id, 'device_move_id' => $move->id, 'cutover_at' => $at, 'history_included' => false,
                ]);
                $row->update(['successor_device_id' => $successor->id, 'state' => 'moved', 'outstanding_key' => null]);
                $successors[$predecessor->uuid] = $successor;
                ActivityLog::record('device.moved_out', $source, $mover, $predecessor, ['target' => $target->name, 'move_uuid' => $move->uuid]);
                ActivityLog::record('device.moved_in', $target, $mover, $successor, ['source' => $source->name, 'move_uuid' => $move->uuid]);
                $moved[] = $predecessor;
            }
            $this->items->apply($move, $source, $target, $mover, $successors, array_merge([], ...array_map(fn (DeviceProfileCopy $copy): array => $copy->parameter_map, array_values($copies))));
            $this->endAlerts($move, $source, $predecessors->keys());
            foreach ($predecessors as $predecessor) {
                app(GeofenceService::class)->removeDevice($source, $predecessor, $mover->id);
            }
            $move->update(['status' => 'completed', 'cutover_at' => $at, 'finished_at' => $at]);
            ActivityLog::record('device_move.completed', $source, $mover, $move, ['target' => $target->name, 'devices' => $rows->count()]);
            ActivityLog::record('device_move.completed', $target, $mover, $move, ['source' => $source->name, 'devices' => $rows->count()]);
            DB::afterCommit(function () use ($adapters, $mover, $source, $moved): void {
                app(AdapterService::class)->redeployOnce($adapters, $mover->id);
                $this->stopCaptures($source, $moved);
            });
        });
    }

    /**
     * Why the cutover can't go ahead, or null: the organizations left one account, the
     * mover lost `Device.move` in either, a predecessor runs again, or a successor code was
     * taken while the move waited.
     *
     * @param  Collection<int, DeviceMoveDevice>  $rows
     * @param  Collection<int, Device>  $predecessors
     */
    private function refusal(DeviceMove $move, ?Organization $source, ?Organization $target, ?User $mover, Collection $rows, Collection $predecessors): ?string
    {
        if (! $source || ! $target || ! Pipes::sameAccount($source->id, $target->id) || $source->billing_account_id !== $move->billing_account_id) {
            return 'The organizations are no longer in one billing account.';
        }
        if (! $mover || ! $this->authorization->capabilities($mover, $source)['move'] || ! $this->authorization->capabilities($mover, $target)['move']) {
            return 'The person who moved the devices can no longer move devices between '.$source->name.' and '.$target->name.'.';
        }
        foreach ($rows as $row) {
            $predecessor = $predecessors[$row->predecessor_device_id];
            if ($predecessor->lifecycle === 'archived' || $predecessor->applied_configuration_uuid || $predecessor->desired_configuration_uuid || $predecessor->deployment_status === 'pending') {
                return $predecessor->name.' changed in '.$source->name.' while the move waited.';
            }
            if (Device::where('organization_id', $target->id)->where('code', $row->code)->exists()) {
                return 'The code '.$row->code.' was taken in '.$target->name.' while the move waited.';
            }
        }

        return $this->items->refusal($move, $source, $target, $mover, $predecessors->pluck('uuid')->all());
    }

    /**
     * Each distinct profile version the successors need, copied into the target.
     *
     * @param  Collection<int, Device>  $predecessors
     * @return array<int, DeviceProfileCopy> by source artifact id
     */
    private function copies(Collection $predecessors, Organization $source, Organization $target, User $mover): array
    {
        $copies = [];
        foreach ($predecessors as $predecessor) {
            $artifact = $this->artifact($predecessor, $source);
            if ($artifact && ! isset($copies[$artifact->id])) {
                $copies[$artifact->id] = $this->copier->copy($artifact, $target, $mover);
            }
        }

        return $copies;
    }

    private function artifact(Device $predecessor, Organization $source): ?DeviceProfileArtifact
    {
        $base = MovePreview::baseDraft($predecessor);

        return $base ? DeviceProfileArtifact::where('uuid', $base['artifact_uuid'])->whereHas('profile', fn ($q) => $q->where('organization_id', $source->id))->first() : null;
    }

    /**
     * Archives the predecessor and creates its successor. Returns the successor and the
     * adapter it reports through, if any.
     *
     * @param  array<int, DeviceProfileCopy>  $copies
     * @return array{0: Device, 1: ?int}
     */
    private function successor(DeviceMoveDevice $row, Device $predecessor, Organization $target, User $mover, array $copies, bool $activate): array
    {
        $base = MovePreview::baseDraft($predecessor);
        $artifact = $this->artifact($predecessor, Organization::findOrFail($predecessor->organization_id));
        $copy = $artifact ? $copies[$artifact->id] : null;
        $draft = $base && $copy ? [
            'artifact_uuid' => DeviceProfileArtifact::whereKey($copy->target_artifact_id)->value('uuid'),
            'candidate_uuid' => $base['candidate_uuid'], 'birth_revision' => $base['birth_revision'],
            'mappings' => array_map(fn (array $mapping): array => ['parameter_uuid' => $copy->parameter_map[$mapping['parameter_uuid']] ?? $mapping['parameter_uuid']] + $mapping, $base['mappings']),
        ] : null;
        $source = ['candidate' => $predecessor->device_discovery_candidate_id, 'reserved' => $predecessor->reserved_source_uuid];
        $installation = DeviceInstallation::end($predecessor, 'moved');
        // A gateway source stays with its owner, who can onboard it again once no device holds it.
        DeviceOnboarding::release($predecessor);
        $predecessor->forceFill(['lifecycle' => 'archived', 'reserved_source_uuid' => null, 'draft_revision' => $predecessor->draft_revision + 1, 'updated_by' => $mover->id])->save();

        $successor = Device::create([
            'organization_id' => $target->id, 'name' => $row->name, 'code' => $row->code,
            'serial_number' => $predecessor->serial_number, 'description' => $predecessor->description,
            'site_id' => $row->target_site_id && Site::whereKey($row->target_site_id)->where('organization_id', $target->id)->exists() ? $row->target_site_id : null,
            'tags' => $predecessor->tags, 'custom_attributes' => $predecessor->custom_attributes,
            'device_discovery_candidate_id' => $source['candidate'], 'reserved_source_uuid' => $source['reserved'],
            'draft' => $draft, 'created_by' => $mover->id, 'updated_by' => $mover->id,
        ])->refresh();
        $adapter = null;
        if ($installation) {
            $candidate = AdapterCandidate::with('adapter')->findOrFail($installation->device_adapter_candidate_id);
            app(AdapterService::class)->install($candidate, $candidate->adapter, $successor, $mover->id);
            $adapter = $candidate->adapter->id;
        }
        $this->limit->transfer($predecessor, $successor);
        if ($activate && $draft) {
            try {
                $this->configuration->activate($successor, $successor->draft_revision, $mover->id);
            } catch (HttpExceptionInterface|ValidationException $exception) {
                // Its draft stays, so a member of the target activates it later (research R6).
                $reason = $exception instanceof ValidationException ? collect($exception->errors())->flatten()->first() : $exception->getMessage();
                $successor = $successor->fresh();
                $successor->forceFill(['diagnostic' => mb_substr((string) $reason, 0, 2000)])->save();
                $this->limit->release($successor);
            }
        } else {
            $this->limit->release($successor);
        }

        return [$successor->fresh(), $adapter];
    }

    /**
     * Ends the predecessors' open alerts as `device_moved`, and relabels the connectivity
     * alerts their stop ended as `device_deactivated` during the move (research R7). A
     * gateway alert that still lists a device staying behind the gateway stays open.
     *
     * @param  Collection<int, int>  $ids
     */
    private function endAlerts(DeviceMove $move, Organization $source, Collection $ids): void
    {
        Alert::where('organization_id', $source->id)->whereNull('cleared_at')->endingWithMoved($ids)
            ->update(['cleared_at' => now(), 'stopped_reason' => Alert::STOPPED_DEVICE_MOVED]);
        Alert::where('organization_id', $source->id)->where('stopped_reason', 'device_deactivated')->where('cleared_at', '>=', $move->confirmed_at)->endingWithMoved($ids)
            ->update(['stopped_reason' => Alert::STOPPED_DEVICE_MOVED]);
    }

    /**
     * Stops the source's running captures of the moved devices or their sources. Best
     * effort: a capture the runtime does not stop expires within ten minutes.
     *
     * @param  list<Device>  $moved
     */
    private function stopCaptures(Organization $source, array $moved): void
    {
        try {
            $runtime = app(RuntimeClient::class);
            $uuids = array_map(fn (Device $device): string => $device->uuid, $moved);
            $sources = collect($moved)->map(fn (Device $device) => $device->candidate)->filter()
                ->map(fn ($candidate): string => $candidate->gateway->uuid.'/'.$candidate->source_device_id)->all();
            foreach ($runtime->request('GET', '/internal/telemetry/captures', ['organization_uuid' => $source->uuid])['data'] ?? [] as $capture) {
                $scope = $capture['scope'] ?? [];
                $named = in_array($scope['device_uuid'] ?? '', $uuids, true)
                    || (($scope['source_device_id'] ?? null) !== null && in_array(($scope['gateway_uuid'] ?? '').'/'.$scope['source_device_id'], $sources, true));
                if ($named && ! ($capture['stopped'] ?? false)) {
                    $runtime->request('POST', '/internal/telemetry/captures/'.rawurlencode($capture['id']), ['organization_uuid' => $source->uuid, 'action' => 'stop']);
                }
            }
        } catch (Throwable $exception) {
            Log::info('Captures of moved devices were left to expire.', ['organization_uuid' => $source->uuid, 'reason' => $exception->getMessage()]);
        }
    }
}
