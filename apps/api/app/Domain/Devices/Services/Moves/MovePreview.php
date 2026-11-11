<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services\Moves;

use App\Domain\Automation\Models\Alert;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\DeviceProfiles\Services\ProfileCopier;
use App\Domain\DeviceProfiles\Support\CanonicalJson;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceMoveDevice;
use App\Domain\Devices\Models\DeviceOperation;
use App\Domain\Devices\Models\Site;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Devices\Services\Pipes;
use App\Domain\Geospatial\Models\GeofenceAssignment;
use App\Domain\Geospatial\Models\LocationBinding;
use App\Domain\Integrations\Models\IntegrationApplication;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The review of a move (spec 031, contract § Review): what moves, what blocks it, how
 * each device reports, what ends, which profile versions are copied, in sentences. It
 * changes nothing. Its hash is what the confirmation must match, so a changed situation
 * is reviewed again (research R10).
 *
 * The dashboards and automations that use the devices are listed with a choice each
 * (CarriedItems); until PR 031-7 direct devices are blocked (research R22). Devices
 * behind a gateway move like adapter-fed ones: the gateway stays with its owner (R14).
 */
final class MovePreview
{
    public const LIMIT = 100;

    public const ARCHIVED = 'Archived';

    public const WAITING = 'Waiting for the runtime';

    public const MOVING = 'Already being moved';

    public const DIRECT = 'Directly connected devices can’t be moved yet';

    public function __construct(
        private readonly DeviceAuthorization $authorization,
        private readonly Pipes $pipes,
        private readonly ProfileCopier $copier,
        private readonly CanonicalJson $canonical,
        private readonly CarriedItems $carried,
    ) {}

    /** @return array<string, list<mixed>> */
    public static function rules(): array
    {
        return [
            'target_organization_uuid' => ['required', 'uuid'],
            'device_uuids' => ['required', 'array', 'min:1', 'max:'.self::LIMIT], 'device_uuids.*' => ['required', 'uuid', 'distinct'],
            'devices' => ['sometimes', 'array', 'max:'.self::LIMIT], 'devices.*' => ['array:uuid,name,code,site_uuid'],
            'devices.*.uuid' => ['required', 'uuid', 'distinct'], 'devices.*.name' => ['sometimes', 'string', 'max:255'],
            'devices.*.code' => ['sometimes', 'string', 'max:128', 'regex:/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/'], 'devices.*.site_uuid' => ['sometimes', 'nullable', 'uuid'],
            ...CarriedItems::rules(),
            // Readings from before the move are offered from PR 031-9.
            'include_history' => ['sometimes', 'boolean', 'declined'],
        ];
    }

    /** @return array<string, string> */
    public static function messages(): array
    {
        return [
            'device_uuids.max' => 'Move at most '.self::LIMIT.' devices at a time.',
            'include_history.declined' => 'Readings from before the move can’t be included yet.',
        ];
    }

    /**
     * The target, when the person may move devices into it: another organization of the
     * source's billing account where they are a member (else 404) holding `Device.move`
     * (else 403).
     */
    public function target(Organization $source, User $user, string $uuid): Organization
    {
        $target = Organization::where('uuid', $uuid)->first();
        abort_unless($target && $target->id !== $source->id && Pipes::sameAccount($source->id, $target->id), 404);
        abort_unless($user->is_super_admin || $user->organizations()->whereKey($target->id)->exists(), 404);
        abort_unless($this->authorization->capabilities($user, $target)['move'], 403);

        return $target;
    }

    /**
     * Builds the review. With `$lock`, the devices are locked for the confirmation's
     * transaction.
     *
     * @param  array{device_uuids: list<string>, devices?: list<array<string, mixed>>}  $input
     */
    public function review(Organization $source, Organization $target, User $user, array $input, bool $lock = false): array
    {
        return $this->build($source, $target, $user, $input, $lock)['review'];
    }

    /**
     * The review, its hash, and what the confirmation acts on: the devices and each one's
     * successor, base configuration and artifact, and the dashboards and automations with
     * the choice for each.
     *
     * @return array{review: array<string, mixed>, devices: Collection<string, Device>, rows: list<array<string, mixed>>, artifacts: Collection<int, DeviceProfileArtifact>, items: list<array{model: mixed, view: array<string, mixed>}>}
     */
    public function build(Organization $source, Organization $target, User $user, array $input, bool $lock = false): array
    {
        $uuids = array_values($input['device_uuids']);
        $query = Device::query()->where('organization_id', $source->id)->whereIn('uuid', $uuids)
            ->with(['openInstallation.candidate.adapter.gateway', 'candidate.gateway.connection', 'candidate.gateway.adapter.gateway', 'lastAppliedConfiguration', 'organization']);
        $devices = ($lock ? $query->orderBy('id')->lockForUpdate() : $query)->get()->keyBy('uuid');
        abort_unless($devices->count() === count($uuids), 404);
        $overrides = $this->overrides($input['devices'] ?? [], $uuids, $target);

        $ids = $devices->pluck('id');
        $pending = DeviceOperation::whereIn('device_id', $ids)->where('status', 'pending')->pluck('device_id')->flip();
        $moving = DeviceMoveDevice::whereIn('outstanding_key', $ids)->pluck('outstanding_key')->flip();
        $canActivate = $this->authorization->capabilities($user, $target)['activate'];
        $wanted = collect($uuids)->map(fn (string $uuid) => $overrides[$uuid]['code'] ?? $devices[$uuid]->code);
        $taken = Device::where('organization_id', $target->id)->whereIn('code', $wanted)->pluck('code')->flip();

        $rows = [];
        $codes = [];
        $artifacts = collect();
        foreach ($uuids as $i => $uuid) {
            $device = $devices[$uuid];
            $override = $overrides[$uuid] ?? [];
            $pipe = $this->pipes->for($device);
            $gateway = $device->candidate?->gateway;
            $direct = ! $pipe && $gateway && str_starts_with($gateway->connection->group_id, 'onboarding-');
            $blockers = [];
            if ($device->lifecycle === 'archived') {
                $blockers[] = self::ARCHIVED;
            } elseif ($device->deployment_status === 'pending' || $pending->has($device->id)) {
                $blockers[] = self::WAITING;
            }
            if ($moving->has($device->id)) {
                $blockers[] = self::MOVING;
            }
            if ($direct) {
                $blockers[] = self::DIRECT;
            }
            if (isset($override['code'])) {
                $code = $override['code'];
                if ($taken->has($code)) {
                    $blockers[] = 'Code already used in '.$target->name;
                } elseif (isset($codes[mb_strtolower($code)])) {
                    $blockers[] = 'Code already used by another device in this move';
                }
            } else {
                $code = $this->freeCode($device->code, $target, $taken, $codes);
            }
            $codes[mb_strtolower($code)] = true;
            $base = self::baseDraft($device);
            $artifact = $base ? DeviceProfileArtifact::where('uuid', $base['artifact_uuid'])->whereHas('profile', fn ($q) => $q->where('organization_id', $source->id))->with('profile')->first() : null;
            if ($artifact) {
                $artifacts->put($artifact->id, $artifact);
            }
            $wasActive = $device->lifecycle === 'active';
            $rows[] = [
                'device' => $device, 'base' => $base, 'artifact' => $artifact, 'stops' => $device->applied_configuration_uuid !== null,
                'site' => $override['site'] ?? null, 'pipe' => $pipe,
                'view' => [
                    'uuid' => $device->uuid, 'name' => $device->name, 'code' => $device->code,
                    'successor' => ['name' => $override['name'] ?? $device->name, 'code' => $code, 'site_uuid' => ($override['site'] ?? null)?->uuid],
                    'reports_through' => $pipe ? ['kind' => $pipe->kind, 'name' => $pipe->name, 'owner_organization_name' => $pipe->ownerOrganizationName, 'outcome' => 'stays']
                        : ($direct ? ['kind' => 'direct', 'name' => $gateway->name, 'owner_organization_name' => $source->name, 'outcome' => 'moves'] : null),
                    'arrives_active' => $wasActive && $canActivate,
                    'blockers' => $blockers,
                ],
                'was_active' => $wasActive,
            ];
        }

        $views = array_column($rows, 'view');
        // Panels and bindings name the source's parameters; the copies map each one (research R5).
        $parameters = $artifacts->flatMap(fn (DeviceProfileArtifact $artifact) => array_column($artifact->definition['parameters'] ?? [], 'uuid'))->unique()->values()->all();
        $carried = $this->carried->review($source, $target, $user, $devices, array_column($views, 'arrives_active', 'uuid'), array_combine($parameters, $parameters), $input['items'] ?? []);
        $items = array_column($carried['rows'], 'view');
        $copies = $artifacts->values()->map(fn (DeviceProfileArtifact $artifact): array => [
            'profile' => $artifact->profile->name, 'revision' => $artifact->revision,
            'code' => $this->copier->codeFor($artifact, $target), 'reused' => $this->copier->copied($artifact, $target),
        ])->sortBy(['profile', 'revision'])->values()->all();
        $ends = $this->ends($source, $devices);
        $review = [
            'can_confirm' => collect($views)->every(fn (array $view): bool => $view['blockers'] === []),
            'devices' => $views,
            'items' => $items,
            'ends' => $ends,
            'profile_copies' => $copies,
            'pipe_owner_sees_raw_messages' => collect($rows)->contains(fn (array $row): bool => $row['pipe'] !== null),
            'history' => ['offered' => false, 'include' => false],
            'summary' => $this->summary($source, $target, $rows, $ends, count($copies), $items),
            'archives' => array_values(array_map(fn (array $item): array => ['kind' => $item['kind'], 'uuid' => $item['uuid'], 'name' => $item['name']], array_filter($items, fn (array $item): bool => $item['action'] === 'archive'))),
        ];
        // The hash also covers what the review does not show but the cutover copies.
        $state = $devices->map(fn (Device $device): array => [$device->deployment_generation, $device->last_applied_configuration_uuid, $device->draft_revision])->sortKeys()->all();
        $review = ['preview_hash' => hash('sha256', $this->canonical->encode(['review' => $review, 'state' => $state, 'items' => $carried['state'], 'target' => $target->uuid])), ...$review];

        return ['review' => $review, 'devices' => $devices, 'rows' => $rows, 'artifacts' => $artifacts, 'items' => $carried['rows']];
    }

    /**
     * The configuration the successor starts from: the predecessor's last applied one as
     * a draft, else its draft. Null without a profile revision.
     *
     * @return ?array{artifact_uuid: string, candidate_uuid: ?string, birth_revision: ?int, mappings: list<array<string, mixed>>}
     */
    public static function baseDraft(Device $device): ?array
    {
        $definition = $device->lastAppliedConfiguration?->definition;
        if ($definition) {
            return [
                'artifact_uuid' => $definition['profile_artifact_uuid'], 'candidate_uuid' => $definition['source']['candidate_uuid'] ?? null,
                'birth_revision' => $definition['birth_revision'] ?? null,
                'mappings' => array_map(fn (array $mapping): array => [
                    'parameter_uuid' => $mapping['parameter_uuid'], 'metric' => $mapping['metric'],
                    'conversion_mode' => $mapping['conversion_mode'] ?? 'profile',
                    'ingress_conversion' => ($mapping['conversion_mode'] ?? 'profile') === 'custom' ? $mapping['ingress_conversion'] : null,
                    'command_metric' => $mapping['command_metric'] ?? null,
                ], $definition['mappings'] ?? []),
            ];
        }
        $draft = $device->draft ?? [];

        return empty($draft['artifact_uuid']) ? null : [
            'artifact_uuid' => $draft['artifact_uuid'], 'candidate_uuid' => $draft['candidate_uuid'] ?? null,
            'birth_revision' => $draft['birth_revision'] ?? null, 'mappings' => $draft['mappings'] ?? [],
        ];
    }

    /**
     * The overrides by device uuid, with each site resolved in the target.
     *
     * @param  list<array<string, mixed>>  $overrides
     * @param  list<string>  $uuids
     * @return array<string, array<string, mixed>>
     */
    private function overrides(array $overrides, array $uuids, Organization $target): array
    {
        $sites = Site::where('organization_id', $target->id)->whereIn('uuid', array_filter(array_column($overrides, 'site_uuid')))->get()->keyBy('uuid');
        $errors = [];
        $result = [];
        foreach ($overrides as $i => $override) {
            if (! in_array($override['uuid'], $uuids, true)) {
                $errors["devices.$i.uuid"] = 'This device is not part of the move.';

                continue;
            }
            if (($override['site_uuid'] ?? null) !== null) {
                $site = $sites->get($override['site_uuid']);
                if (! $site) {
                    $errors["devices.$i.site_uuid"] = 'Choose a site of '.$target->name.'.';
                }
                $override['site'] = $site;
            }
            $result[$override['uuid']] = $override;
        }
        if ($errors) {
            throw ValidationException::withMessages($errors);
        }

        return $result;
    }

    /**
     * The device's code when the target has no device with it, else the first free
     * `<code>-2`, `-3`… The target keeps archived devices' codes, so a device moved back
     * gets a new one.
     *
     * @param  Collection<string, int>  $taken
     * @param  array<string, true>  $codes  codes earlier devices of the move take
     */
    private function freeCode(string $code, Organization $target, Collection $taken, array $codes): string
    {
        $candidate = $code;
        for ($suffix = 2; $taken->has($candidate) || isset($codes[mb_strtolower($candidate)]) || ($candidate !== $code && Device::where('organization_id', $target->id)->where('code', $candidate)->exists()); $suffix++) {
            $candidate = Str::limit($code, 120, '').'-'.$suffix;
        }

        return $candidate;
    }

    /**
     * What ends for the predecessors: open alerts, geofence assignments, and the
     * integration applications that keep reading their history but never the successors.
     *
     * @param  Collection<string, Device>  $devices
     * @return array{alerts: int, geofence_assignments: int, application_grants: list<array{name: string, devices: int}>}
     */
    private function ends(Organization $source, Collection $devices): array
    {
        $ids = $devices->pluck('id');
        $alerts = Alert::where('organization_id', $source->id)->whereNull('cleared_at')->endingWithMoved($ids)->count();
        $geofences = GeofenceAssignment::whereIn('device_location_binding_id', LocationBinding::where('organization_id', $source->id)->whereIn('device_id', $ids)->select('id'))->count();
        $uuids = $devices->keys()->all();
        $sites = $devices->pluck('site_id')->filter()->unique();
        $siteUuids = Site::whereIn('id', $sites)->pluck('uuid', 'id');
        $grants = IntegrationApplication::where('organization_id', $source->id)->whereNull('revoked_at')->orderBy('name')->get()
            ->map(function (IntegrationApplication $application) use ($devices, $uuids, $siteUuids): array {
                $scope = $application->site_uuids;
                $count = $scope === null
                    ? count(array_intersect($uuids, $application->device_uuids ?? []))
                    : $devices->filter(fn (Device $device): bool => $device->site_id !== null && in_array($siteUuids[$device->site_id] ?? null, $scope, true))->count();

                return ['name' => $application->name, 'devices' => $count];
            })->filter(fn (array $grant): bool => $grant['devices'] > 0)->values()->all();

        return ['alerts' => $alerts, 'geofence_assignments' => $geofences, 'application_grants' => $grants];
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @param  array{alerts: int, geofence_assignments: int, application_grants: list<array{name: string, devices: int}>}  $ends
     * @param  list<array<string, mixed>>  $items  the dashboards and automations, as reviewed
     * @return list<string>
     */
    private function summary(Organization $source, Organization $target, array $rows, array $ends, int $copies, array $items): array
    {
        $count = fn (int $n, string $one, ?string $many = null): string => $n.' '.($n === 1 ? $one : ($many ?? $one.'s'));
        $chosen = fn (string $kind, string $action): array => array_values(array_filter($items, fn (array $item): bool => $item['kind'] === $kind && $item['action'] === $action));
        $both = function (int $dashboards, int $automations) use ($count): string {
            return implode(' and ', array_filter([$dashboards ? $count($dashboards, 'dashboard') : null, $automations ? $count($automations, 'automation') : null]));
        };
        $moving = [$count(count($rows), 'device'), ...array_filter([$chosen('dashboard', 'move') ? $count(count($chosen('dashboard', 'move')), 'dashboard') : null, $chosen('automation', 'move') ? $count(count($chosen('automation', 'move')), 'automation') : null])];
        $many = count($rows) > 1 || count($moving) > 1;
        $sentences = [(count($moving) > 1 ? implode(', ', array_slice($moving, 0, -1)).' and '.end($moving) : $moving[0]).' '.($many ? 'move' : 'moves').' to '.$target->name.'.'];
        foreach (collect($rows)->pluck('pipe')->filter()->groupBy(fn ($pipe) => $pipe->kind.':'.($pipe->adapterId ?? $pipe->gatewayId)) as $pipes) {
            $pipe = $pipes->first();
            $sentences[] = $count($pipes->count(), 'device').' '.($pipes->count() === 1 ? 'keeps' : 'keep').' reporting through the '.$pipe->kind.' '.$pipe->name.', which stays with '.$pipe->ownerOrganizationName.'.';
        }
        $inactive = collect($rows)->filter(fn (array $row): bool => $row['was_active'] && ! $row['view']['arrives_active'])->count();
        if ($inactive) {
            $sentences[] = $count($inactive, 'active device').' '.($inactive === 1 ? 'arrives' : 'arrive').' inactive, because you can’t activate devices in '.$target->name.'.';
        }
        if ($copied = count($chosen('dashboard', 'copy'))) {
            $sentences[] = $count($copied, 'dashboard').' '.($copied === 1 ? 'is' : 'are').' copied to '.$target->name.' with only the moving devices’ panels.';
        }
        $off = count(array_filter($chosen('automation', 'move'), fn (array $item): bool => $item['running'] && ! $item['arrives_running']));
        if ($off) {
            $sentences[] = $count($off, 'running automation').' '.($off === 1 ? 'arrives' : 'arrive').' off in '.$target->name.'.';
        }
        if ($archived = $both(count($chosen('dashboard', 'archive')), count($chosen('automation', 'archive')))) {
            $sentences[] = $archived.' '.(count($chosen('dashboard', 'archive')) + count($chosen('automation', 'archive')) === 1 ? 'is' : 'are').' archived in '.$source->name.'.';
        }
        if ($kept = count($chosen('dashboard', 'keep'))) {
            $sentences[] = $count($kept, 'dashboard').' '.($kept === 1 ? 'stays' : 'stay').' in '.$source->name.', showing the moved devices up to the move.';
        }
        if ($kept = count($chosen('automation', 'keep'))) {
            $sentences[] = $count($kept, 'automation').' '.($kept === 1 ? 'stays' : 'stay').' in '.$source->name.' and can’t run until the moved devices are removed from '.($kept === 1 ? 'it' : 'them').'.';
        }
        if ($copies) {
            $sentences[] = $count($copies, 'device profile version').' '.($copies === 1 ? 'is' : 'are').' copied to '.$target->name.'.';
        }
        if ($ends['alerts']) {
            $sentences[] = $count($ends['alerts'], 'open alert').' '.($ends['alerts'] === 1 ? 'ends' : 'end').'.';
        }
        if ($ends['geofence_assignments']) {
            $sentences[] = $count($ends['geofence_assignments'], 'geofence assignment').' '.($ends['geofence_assignments'] === 1 ? 'ends' : 'end').'.';
        }

        return $sentences;
    }
}
