<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\Devices\Enums\BulkOnboardingItemStatus;
use App\Domain\Devices\Enums\BulkOnboardingStatus;
use App\Domain\Devices\Jobs\OnboardDiscoveredSources;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceBulkOnboarding;
use App\Domain\Devices\Models\DeviceBulkOnboardingItem;
use App\Domain\Devices\Models\DeviceOnboarding;
use App\Domain\Devices\Models\DiscoveryCandidate;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Shared\Models\Organization;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

/**
 * Bulk onboarding of discovered sources (spec 026 US5, R18), following the geofence
 * activation batch: a run keyed by `operation_uuid` plus a request hash, one item per
 * source, per-item outcomes that never stop the rest, retry of failed items and a run
 * status rolled up from its items. {@see OnboardDiscoveredSources} does the work.
 */
final class BulkOnboarding
{
    /** Sources per run; more must be split into several runs. */
    public const MAX_SOURCES = 500;

    /** Placeholders a name pattern may use; `{device_id}` is required. */
    public const PLACEHOLDERS = ['{device_id}', '{gateway}', '{n}'];

    public function __construct(
        private readonly DeviceConfigurationService $configuration,
        private readonly MappingSuggestions $suggestions,
    ) {}

    /**
     * Queues a run, or returns the existing run for a repeated request.
     *
     * @param  array{operation_uuid: string, artifact_uuid: string, name_pattern: string, source_device_ids: list<string>}  $input
     */
    public function start(Organization $organization, SparkplugGateway $gateway, array $input, int $actor): DeviceBulkOnboarding
    {
        $ids = $input['source_device_ids'];
        sort($ids, SORT_NATURAL);
        $hash = hash('sha256', json_encode([$gateway->uuid, $input['artifact_uuid'], $input['name_pattern'], $ids], JSON_THROW_ON_ERROR));
        if ($existing = $this->existing($organization, $input['operation_uuid'], $hash)) {
            return $existing;
        }
        abort_unless($gateway->connection->status === 'ready', 422, 'The gateway’s connection must be provisioned first.');
        abort_if(DeviceAdapter::where('sparkplug_gateway_id', $gateway->id)->exists(), 422, 'This gateway belongs to a device adapter. Activate its sources from the adapter.');
        $artifact = DeviceProfileArtifact::where('uuid', $input['artifact_uuid'])->whereHas('profile', fn ($q) => $q->where('organization_id', $organization->id))->first();
        if (! $artifact) {
            throw ValidationException::withMessages(['artifact_uuid' => 'Choose a published revision of one of this organization’s profiles.']);
        }
        $candidates = DiscoveryCandidate::where('sparkplug_gateway_id', $gateway->id)->whereIn('source_device_id', $ids)->pluck('id', 'source_device_id');
        $unknown = [];
        foreach ($input['source_device_ids'] as $i => $id) {
            if (! $candidates->has($id)) {
                $unknown["source_device_ids.$i"] = $id.' is not a discovered source of this gateway.';
            }
        }
        if ($unknown) {
            throw ValidationException::withMessages($unknown);
        }

        return DB::transaction(function () use ($organization, $gateway, $input, $actor, $artifact, $ids, $candidates, $hash) {
            // Serialize run creation per tenant, so a retried request cannot start two runs.
            Organization::whereKey($organization->id)->lockForUpdate()->firstOrFail();
            if ($existing = $this->existing($organization, $input['operation_uuid'], $hash)) {
                return $existing;
            }
            $run = DeviceBulkOnboarding::create([
                'uuid' => $input['operation_uuid'], 'organization_id' => $organization->id, 'sparkplug_gateway_id' => $gateway->id,
                'device_profile_artifact_id' => $artifact->id, 'name_pattern' => $input['name_pattern'], 'request_hash' => $hash,
                'status' => BulkOnboardingStatus::Queued, 'created_by' => $actor,
            ]);
            $now = now();
            foreach (array_chunk($ids, 250) as $chunk) {
                DeviceBulkOnboardingItem::insert(array_map(fn (string $id) => [
                    'device_bulk_onboarding_id' => $run->id, 'source_device_id' => $id, 'discovery_candidate_id' => $candidates[$id],
                    'status' => BulkOnboardingItemStatus::Pending->value, 'attempts' => 0, 'created_at' => $now, 'updated_at' => $now,
                ], $chunk));
            }
            ActivityLog::record('device.bulk_onboarding.started', $organization->id, $actor, $gateway, ['run_uuid' => $run->uuid, 'profile_revision' => $artifact->revision, 'count' => count($ids)]);
            OnboardDiscoveredSources::dispatch($run->id)->afterCommit();

            return $run;
        });
    }

    /** Re-queues the failed items only; skipped sources do not match the profile and need a new run. */
    public function retry(DeviceBulkOnboarding $run, int $actor): DeviceBulkOnboarding
    {
        return DB::transaction(function () use ($run, $actor) {
            $locked = DeviceBulkOnboarding::whereKey($run->id)->lockForUpdate()->firstOrFail();
            abort_unless($locked->status->finished(), 409, 'Wait for the run to finish before retrying.');
            $count = $locked->items()->where('status', BulkOnboardingItemStatus::Failed->value)->update([
                'status' => BulkOnboardingItemStatus::Pending->value, 'reason' => null, 'attempts' => DB::raw('attempts + 1'), 'updated_at' => now(),
            ]);
            abort_if($count === 0, 409, 'This run has no failed sources to retry.');
            $locked->update(['status' => BulkOnboardingStatus::Queued, 'finished_at' => null]);
            ActivityLog::record('device.bulk_onboarding.retried', $locked->organization_id, $actor, $locked->gateway, ['run_uuid' => $locked->uuid, 'count' => $count]);
            OnboardDiscoveredSources::dispatch($locked->id)->afterCommit();

            return $locked;
        });
    }

    /**
     * Onboards one item, claimed under a row lock and re-checked as pending so a
     * duplicate job cannot onboard a source twice. Its device, setup, draft and
     * activation request are made together or not at all (the AdapterService::activate
     * sequence). A source that does not fit is skipped with the reason; anything else
     * marks the item failed for a retry.
     */
    public function onboard(DeviceBulkOnboarding $run, int $itemId): void
    {
        DB::transaction(function () use ($run, $itemId): void {
            $item = DeviceBulkOnboardingItem::whereKey($itemId)->lockForUpdate()->first();
            if (! $item || $item->status !== BulkOnboardingItemStatus::Pending) {
                return;
            }
            try {
                $device = DB::transaction(fn () => $this->create($run, $item));
                $item->update(['status' => BulkOnboardingItemStatus::ActivationRequested, 'device_id' => $device->id, 'reason' => null]);
            } catch (ValidationException $exception) {
                $item->update(['status' => BulkOnboardingItemStatus::Skipped, 'reason' => self::reason(collect($exception->errors())->flatten()->first() ?? $exception->getMessage())]);
            } catch (HttpExceptionInterface $exception) {
                $status = $exception->getStatusCode() < 500 ? BulkOnboardingItemStatus::Skipped : BulkOnboardingItemStatus::Failed;
                $item->update(['status' => $status, 'reason' => self::reason($exception->getMessage() ?: 'The source could not be onboarded.')]);
            } catch (\Throwable $exception) {
                report($exception);
                $item->update(['status' => BulkOnboardingItemStatus::Failed, 'reason' => 'The source could not be onboarded. Retry the failed sources.']);
            }
        });
    }

    /** Marks the items no job reached as failed, so they can be retried. */
    public function abandon(DeviceBulkOnboarding $run): void
    {
        $run->items()->where('status', BulkOnboardingItemStatus::Pending->value)->update([
            'status' => BulkOnboardingItemStatus::Failed->value, 'reason' => 'Onboarding stopped before this source. Retry the failed sources.', 'updated_at' => now(),
        ]);
    }

    /** Rolls a run up once no item is pending, and records the outcome. */
    public function finish(DeviceBulkOnboarding $run): void
    {
        DB::transaction(function () use ($run): void {
            $locked = DeviceBulkOnboarding::whereKey($run->id)->lockForUpdate()->firstOrFail();
            $counts = $this->stored($locked);
            if ($locked->status !== BulkOnboardingStatus::Running || $counts['pending'] > 0) {
                return;
            }
            $status = self::rollUp($counts);
            $locked->update(['status' => $status, 'finished_at' => now()]);
            ActivityLog::record('device.bulk_onboarding.finished', $locked->organization_id, null, $locked->gateway, ['run_uuid' => $locked->uuid, 'status' => $status->value, 'counts' => $counts]);
        });
    }

    /**
     * `succeeded` when every item is activation requested or later, `partial_failure`
     * when some were skipped or failed and at least one succeeded, `failed` when none did.
     *
     * @param  array<string, int>  $counts
     */
    public static function rollUp(array $counts): BulkOnboardingStatus
    {
        if (($counts['pending'] ?? 0) > 0) {
            return BulkOnboardingStatus::Running;
        }
        $unsuccessful = ($counts['skipped'] ?? 0) + ($counts['failed'] ?? 0);
        if ($unsuccessful === 0) {
            return BulkOnboardingStatus::Succeeded;
        }

        return ($counts['activation_requested'] ?? 0) > 0 ? BulkOnboardingStatus::PartialFailure : BulkOnboardingStatus::Failed;
    }

    /**
     * Items by status, with `active` (a subset of activation requested) read from each
     * device's applied configuration, never stored.
     *
     * @return array{pending: int, activation_requested: int, active: int, skipped: int, failed: int}
     */
    public function counts(DeviceBulkOnboarding $run): array
    {
        return [...$this->stored($run), 'active' => $run->items()->where('status', BulkOnboardingItemStatus::ActivationRequested->value)
            ->whereHas('device', fn ($q) => $q->whereNotNull('applied_configuration_uuid'))->count()];
    }

    /**
     * One item as the run panel shows it: `active` once the runtime has acknowledged its
     * device, and the runtime's reason when it refused the configuration.
     *
     * @return array{source_device_id: string, status: 'pending'|'activation_requested'|'active'|'skipped'|'failed', reason: string|null, device_uuid: string|null, attempts: int}
     */
    public static function item(DeviceBulkOnboardingItem $item): array
    {
        $device = $item->device;
        $requested = $item->status === BulkOnboardingItemStatus::ActivationRequested;
        $active = $requested && $device?->applied_configuration_uuid !== null;
        $refused = $requested && ! $active && $device?->deployment_status === 'failed';

        return [
            'source_device_id' => $item->source_device_id,
            'status' => $active ? 'active' : $item->status->value,
            'reason' => $refused ? ($device->diagnostic ?: 'The runtime refused the configuration.') : $item->reason,
            'device_uuid' => $device?->uuid,
            'attempts' => $item->attempts,
        ];
    }

    /** A device name from the run's pattern; `{n}` is the source's place in the sorted selection. */
    public static function name(string $pattern, SparkplugGateway $gateway, string $deviceId, int $n): string
    {
        return mb_substr(trim(str_replace(self::PLACEHOLDERS, [$deviceId, $gateway->name, (string) $n], $pattern)), 0, 255);
    }

    /** `<edge node id>-<device id>`, lowercased, with characters a code cannot hold replaced. */
    public static function code(SparkplugGateway $gateway, string $deviceId): string
    {
        $code = trim((string) preg_replace(['/[^a-z0-9._-]+/', '/-{2,}/'], '-', mb_strtolower($gateway->edge_node_id.'-'.$deviceId)), '._-');

        return mb_substr($code === '' ? 'device' : $code, 0, 120);
    }

    private function create(DeviceBulkOnboarding $run, DeviceBulkOnboardingItem $item): Device
    {
        $gateway = $run->gateway;
        $artifact = $run->artifact;
        $actor = $run->created_by;
        $candidate = DiscoveryCandidate::where('sparkplug_gateway_id', $gateway->id)->where('source_device_id', $item->source_device_id)->lockForUpdate()->first();
        abort_unless($candidate, 422, 'no longer discovered on this gateway');
        $item->discovery_candidate_id = $candidate->id;
        abort_if($candidate->status === 'rejected', 422, 'ignored in Discovery');
        abort_if(DeviceOnboarding::where('sparkplug_gateway_id', $gateway->id)->where('source_device_id', $candidate->source_device_id)->exists()
            || Device::where('reserved_source_uuid', $candidate->uuid)->exists(), 422, 'already onboarded');
        $match = $this->suggestions->forSource($artifact, array_values($candidate->metrics ?? []));
        abort_if($match['problems'] !== [], 422, implode('; ', $match['problems']));

        $n = DeviceBulkOnboardingItem::where('device_bulk_onboarding_id', $run->id)->where('id', '<=', $item->id)->count();
        $name = self::name($run->name_pattern, $gateway, $item->source_device_id, $n);
        $device = Device::create([
            'organization_id' => $run->organization_id, 'name' => $name, 'code' => $this->freeCode($run->organization_id, self::code($gateway, $item->source_device_id)),
            'created_by' => $actor, 'updated_by' => $actor,
            'draft' => ['artifact_uuid' => $artifact->uuid, 'candidate_uuid' => null, 'birth_revision' => null, 'mappings' => []],
        ])->fresh();
        DeviceOnboarding::create([
            'uuid' => (string) Str::uuid(), 'organization_id' => $run->organization_id, 'device_id' => $device->id,
            'sparkplug_gateway_id' => $gateway->id, 'device_profile_artifact_id' => $artifact->id, 'mode' => 'gateway',
            'source_device_id' => $candidate->source_device_id, 'provisioned_at' => now(),
            'request_hash' => hash('sha256', json_encode([$name, $artifact->uuid, 'gateway', $gateway->uuid, $candidate->source_device_id])),
        ]);
        DeviceAudit::record('device.onboarding.started', $run->organization_id, $actor, $device->uuid, ['mode' => 'gateway', 'bulk_run_uuid' => $run->uuid]);
        $device = $this->configuration->saveDraft($device, ['artifact_uuid' => $artifact->uuid, 'candidate_uuid' => $candidate->uuid, 'birth_revision' => $candidate->birth_revision, 'mappings' => $match['mappings']], $device->draft_revision, $actor);

        return $this->configuration->activate($device, $device->draft_revision, $actor);
    }

    /** The code, or the code with the first free numeric suffix (`-2`, `-3`, …). */
    private function freeCode(int $organization, string $code): string
    {
        // An underscore in the code matches any character here; that only loads a few extra codes.
        $taken = Device::where('organization_id', $organization)->where(fn ($q) => $q->where('code', $code)->orWhere('code', 'like', $code.'-%'))->pluck('code')->flip();
        if (! $taken->has($code)) {
            return $code;
        }
        for ($suffix = 2; $taken->has($code.'-'.$suffix); $suffix++);

        return $code.'-'.$suffix;
    }

    /** @return array{pending: int, activation_requested: int, skipped: int, failed: int} */
    private function stored(DeviceBulkOnboarding $run): array
    {
        $counts = ['pending' => 0, 'activation_requested' => 0, 'skipped' => 0, 'failed' => 0];
        foreach ($run->items()->toBase()->selectRaw('status, count(*) as total')->groupBy('status')->pluck('total', 'status') as $status => $total) {
            $counts[$status] = (int) $total;
        }

        return $counts;
    }

    private function existing(Organization $organization, string $operation, string $hash): ?DeviceBulkOnboarding
    {
        $existing = DeviceBulkOnboarding::where('uuid', $operation)->first();
        if (! $existing) {
            return null;
        }
        abort_unless($existing->organization_id === $organization->id, 404);
        abort_unless(hash_equals($existing->request_hash, $hash), 409, 'This operation UUID was already used for a different bulk onboarding.');

        return $existing;
    }

    private static function reason(string $reason): string
    {
        return mb_substr($reason, 0, 500);
    }
}
