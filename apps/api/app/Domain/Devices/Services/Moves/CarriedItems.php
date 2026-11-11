<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services\Moves;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Automation\Models\Deployment;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Automation\Services\DagAuthorization;
use App\Domain\Automation\Services\DagDeployment;
use App\Domain\Automation\Services\WorkflowRewrite;
use App\Domain\Dashboards\Actions\SaveDashboard;
use App\Domain\Dashboards\Models\Dashboard;
use App\Domain\Dashboards\Models\DashboardRevision;
use App\Domain\Dashboards\Models\DashboardShare;
use App\Domain\Dashboards\Services\DashboardAccess;
use App\Domain\Dashboards\Services\DashboardRewrite;
use App\Domain\DeviceProfiles\Support\CanonicalJson;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceMove;
use App\Domain\Devices\Models\DeviceMoveItem;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Geospatial\Models\Geofence;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Collection as Models;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

/**
 * The dashboards and automations that come along with a move (spec 031 US2, research R11).
 *
 * - **Review**: the source's dashboards and automations that use a moving device, whether
 *   they use only moving devices, the choices the mover may make (the first preselected,
 *   never archive), and what each choice leaves out.
 * - **Cutover**: applies each choice in the cutover's transaction, then turns off every
 *   automation kept in the source that still binds a moved device (FR-036).
 * - **Start**: a moved automation that arrives running is turned on in the target once
 *   its devices are active there, since an automation activates against applied
 *   configurations and the successors are still being applied at cutover.
 *
 * A moved dashboard keeps its row. A moved automation is recreated in the target and the
 * source's is turned off and archived as moved, with its run history: the runtime ties a
 * workflow's UUID to one organization, as it does a device's.
 */
final class CarriedItems
{
    /** A binding's configuration when its device has none yet; the editor offers the current one. */
    public const NO_CONFIGURATION = '00000000-0000-0000-0000-000000000000';

    public function __construct(
        private readonly DashboardAccess $dashboards,
        private readonly DagAuthorization $automations,
        private readonly DeviceAuthorization $authorization,
        private readonly CanonicalJson $canonical,
    ) {}

    /** @return array<string, list<mixed>> */
    public static function rules(): array
    {
        return [
            'items' => ['sometimes', 'array', 'max:500'],
            'items.*' => ['array:kind,uuid,action'],
            'items.*.kind' => ['required', Rule::in(DeviceMoveItem::KINDS)],
            'items.*.uuid' => ['required', 'uuid'],
            'items.*.action' => ['required', Rule::in(DeviceMoveItem::ACTIONS)],
        ];
    }

    /**
     * The review rows, dashboards first, each by name. An override names the action for an
     * item; one the item doesn't offer falls back to the preselected choice, so adding
     * devices recomputes every row, and one for an item not listed is ignored.
     *
     * @param  Collection<string, Device>  $moving  by UUID
     * @param  array<string, bool>  $arriving  whether each moving device arrives active, by UUID
     * @param  array<string, string>  $parameters  the moving devices' parameter UUIDs, each to itself
     * @param  list<array{kind: string, uuid: string, action: string}>  $overrides
     * @return array{rows: list<array{model: Dashboard|Workflow, view: array<string, mixed>}>, state: array<string, mixed>}
     */
    public function review(Organization $source, Organization $target, User $mover, Collection $moving, array $arriving, array $parameters, array $overrides): array
    {
        $uuids = $moving->keys()->all();
        $chosen = collect($overrides)->mapWithKeys(fn (array $override): array => [$override['kind'].':'.$override['uuid'] => $override['action']]);
        $workflows = self::workflowsUsing($source, $uuids);
        $dashboards = self::dashboardsUsing($source, $uuids);
        $named = [...$workflows->flatMap(fn (Workflow $workflow) => WorkflowRewrite::devices($workflow->workflow ?? [])), ...$dashboards->flatMap(fn (Dashboard $dashboard) => DashboardRewrite::devices($dashboard->widgets ?? []))];
        $known = Device::where('organization_id', $source->id)->whereIn('uuid', array_values(array_unique($named)))->get(['id', 'uuid', 'name', 'lifecycle'])->keyBy('uuid');
        $sourceAutomations = $this->automations->capabilities($mover, $source);
        $targetAutomations = $this->automations->capabilities($mover, $target);
        $can = [
            'create' => $this->dashboards->capabilities($mover, $target)['create'],
            'manage' => $targetAutomations['manage'],
            'activate' => $targetAutomations['activate'],
            'archive' => $sourceAutomations['manage'] && $sourceAutomations['activate'],
            'enabled' => self::automationsOn($target),
        ];
        $members = $target->users()->pluck('users.id')->all();

        $rows = [];
        $references = [];
        foreach ($workflows as $workflow) {
            $devices = WorkflowRewrite::devices($workflow->workflow ?? []);
            [$only, $others] = self::classify($devices, $moving, $known);
            $actions = $this->offered($only ? ['move', 'keep', 'archive'] : ['keep', 'archive'], ['move' => $can['manage'], 'archive' => $can['archive']]);
            $action = self::choose($actions, $chosen->get('automation:'.$workflow->uuid));
            if ($action === 'move') {
                $references[$workflow->uuid] = $workflow->uuid;
            }
            $running = $workflow->desired_deployment_uuid !== null;
            $off = $action === 'move' && $running ? $this->offReason($workflow, $target, $can, collect($devices)->filter(fn (string $uuid): bool => ! ($arriving[$uuid] ?? false))->map(fn (string $uuid) => $moving[$uuid]->name ?? null)->filter()->first()) : null;
            $usedHere = collect($devices)->filter(fn (string $uuid): bool => $moving->has($uuid))->map(fn (string $uuid): string => $moving[$uuid]->name)->values()->all();
            $rows[] = ['model' => $workflow, 'view' => [
                'kind' => 'automation', 'uuid' => $workflow->uuid, 'name' => $workflow->name,
                'uses_only_moving' => $only, 'actions' => $actions, 'action' => $action,
                'omitted' => ['panels' => [], 'shares' => [], 'recipients' => $action === 'move' ? $this->lostRecipients($workflow, $target) : [], 'references' => []],
                'other_devices' => $only ? null : self::others($others, $moving),
                'running' => $running,
                'arrives_running' => $action === 'move' ? $running && $off === null : null,
                'outcome' => match ($action) {
                    'move' => ! $running ? 'Moves to '.$target->name.', off as it is now.' : ($off ? 'Moves to '.$target->name.' and arrives off, because '.$off.'.' : 'Moves to '.$target->name.' and keeps running there once its devices are active.'),
                    'archive' => ($running ? 'Turned off and archived in ' : 'Archived in ').$source->name.'.',
                    default => 'Stays in '.$source->name.($running ? ' and is turned off until ' : ', and can’t be turned on until ').self::names($usedHere).' '.(count($usedHere) === 1 ? 'is' : 'are').' removed from it.',
                },
            ]];
        }

        $dashboardRows = [];
        foreach ($dashboards as $dashboard) {
            $devices = DashboardRewrite::devices($dashboard->widgets ?? []);
            [$only, $others] = self::classify($devices, $moving, $known);
            $actions = $this->offered($only ? ['move', 'keep', 'archive'] : ['copy', 'keep'], ['move' => $can['create'], 'copy' => $can['create'], 'archive' => $this->dashboards->abilities($mover, $source, $dashboard)['delete']]);
            $action = self::choose($actions, $chosen->get('dashboard:'.$dashboard->uuid));
            $omitted = ['panels' => [], 'shares' => [], 'recipients' => [], 'references' => []];
            $outcome = match ($action) {
                'archive' => 'Archived in '.$source->name.'.',
                'keep' => 'Stays in '.$source->name.' and shows '.self::names($moving->only($devices)->pluck('name')->all()).' up to the move.',
                default => null,
            };
            if (in_array($action, ['move', 'copy'], true)) {
                $rewritten = DashboardRewrite::rewrite($dashboard->widgets ?? [], $dashboard->layouts ?? [], array_combine($uuids, $uuids), $parameters, $references, $action === 'copy');
                $omitted = [...$omitted, ...$this->describe($rewritten['omitted'], $source, $known)];
                if ($action === 'move') {
                    $omitted['shares'] = $this->lostShares($dashboard, $members);
                    $owner = $dashboard->created_by !== null && in_array($dashboard->created_by, $members, true);
                    $outcome = 'Moves to '.$target->name.'.'.($owner ? '' : ' You become its owner there.');
                } else {
                    $total = count($dashboard->widgets ?? []);
                    $outcome = $target->name.' gets a copy with '.count($rewritten['widgets']).' of its '.$total.' '.($total === 1 ? 'panel' : 'panels').', owned by you and shared with no one.';
                }
            }
            $dashboardRows[] = ['model' => $dashboard, 'view' => [
                'kind' => 'dashboard', 'uuid' => $dashboard->uuid, 'name' => $dashboard->name,
                'uses_only_moving' => $only, 'actions' => $actions, 'action' => $action, 'omitted' => $omitted,
                'other_devices' => $only ? null : self::others($others, $moving),
                'running' => null, 'arrives_running' => null, 'outcome' => $outcome,
            ]];
        }

        $state = [
            'dashboards' => $dashboards->mapWithKeys(fn (Dashboard $dashboard): array => [$dashboard->uuid => $dashboard->revision])->sortKeys()->all(),
            'automations' => $workflows->mapWithKeys(fn (Workflow $workflow): array => [$workflow->uuid => [$workflow->draft_revision, $workflow->deployment_generation, $workflow->notification_revision]])->sortKeys()->all(),
        ];

        return ['rows' => [...$dashboardRows, ...$rows], 'state' => $state];
    }

    /**
     * Why the items can't be applied as confirmed, or null: an item changed, was archived
     * or left the source, now uses other devices, is being turned on, or the mover lost the
     * permission its choice needs.
     *
     * @param  list<string>  $uuids  the predecessors' UUIDs
     */
    public function refusal(DeviceMove $move, Organization $source, Organization $target, User $mover, array $uuids): ?string
    {
        foreach ($move->items()->whereIn('action', ['move', 'copy', 'archive'])->get() as $item) {
            $model = $item->kind === 'dashboard' ? Dashboard::find($item->source_item_id) : Workflow::find($item->source_item_id);
            $named = $model === null ? [] : ($item->kind === 'dashboard' ? DashboardRewrite::devices($model->widgets ?? []) : WorkflowRewrite::devices($model->workflow ?? []));
            $existing = Device::where('organization_id', $source->id)->whereIn('uuid', $named)->pluck('uuid')->all();
            if (! $model || $model->organization_id !== $source->id || $model->isArchived()
                || array_intersect($existing, $uuids) === [] || (array_diff($existing, $uuids) === []) !== $item->uses_only_moving) {
                return ($model?->name ?? 'A dashboard or automation').' changed in '.$source->name.' while the move waited.';
            }
            $sourceAutomations = $this->automations->capabilities($mover, $source);
            $allowed = match ($item->kind.':'.$item->action) {
                'dashboard:move', 'dashboard:copy' => $this->dashboards->capabilities($mover, $target)['create'],
                'dashboard:archive' => $this->dashboards->abilities($mover, $source, $model)['delete'],
                'automation:move' => $this->automations->capabilities($mover, $target)['manage'],
                default => $sourceAutomations['manage'] && $sourceAutomations['activate'],
            };
            if (! $allowed) {
                return 'The person who moved the devices can no longer '.$item->action.' '.$model->name.'.';
            }
            if ($item->kind === 'automation' && $model->pending_operation_uuid !== null && $model->desired_deployment_uuid !== null) {
                return $model->name.' was being turned on in '.$source->name.' when the move was ready. Move the devices again once it is on.';
            }
        }

        return null;
    }

    /**
     * Applies the confirmed choices in the cutover's transaction, then turns off the
     * automations kept in the source that still bind a moved device.
     *
     * @param  array<string, Device>  $successors  by predecessor UUID
     * @param  array<string, string>  $parameters  the profile copies' parameter maps, merged
     */
    public function apply(DeviceMove $move, Organization $source, Organization $target, User $mover, array $successors, array $parameters): void
    {
        $devices = array_map(fn (Device $successor): string => $successor->uuid, $successors);
        $bindings = array_map(fn (Device $successor): array => [
            'device_uuid' => $successor->uuid,
            'configuration_uuid' => $successor->desired_configuration_uuid ?? self::NO_CONFIGURATION,
            'generation' => $successor->desired_configuration_uuid ? $successor->deployment_generation : 0,
        ], $successors);
        $items = $move->items()->get();
        $references = [];
        foreach ($items->where('kind', 'automation') as $item) {
            $workflow = Workflow::whereKey($item->source_item_id)->lockForUpdate()->firstOrFail();
            if ($item->action === 'move') {
                $references[$workflow->uuid] = $this->moveAutomation($item, $workflow, $move, $source, $target, $mover, $bindings, $parameters);
            } elseif ($item->action === 'archive') {
                $this->turnOff($workflow, $mover, null);
                $this->archive($workflow, $move, $mover);
                ActivityLog::record('workflow.archived', $source, $mover, $workflow, ['move_uuid' => $move->uuid]);
            }
        }
        foreach ($items->where('kind', 'dashboard') as $item) {
            $dashboard = Dashboard::whereKey($item->source_item_id)->lockForUpdate()->firstOrFail();
            match ($item->action) {
                'move' => $this->moveDashboard($item, $dashboard, $move, $source, $target, $mover, $devices, $parameters, $references),
                'copy' => $this->copyDashboard($item, $dashboard, $move, $target, $mover, $devices, $parameters, $references),
                'archive' => $this->archive($dashboard, $move, $mover),
                default => null,
            };
            if ($item->action === 'archive') {
                ActivityLog::record('dashboard.archived', $source, $mover, $dashboard, ['move_uuid' => $move->uuid]);
            }
        }
        // Kept automations, listed or new since the review, receive nothing more (FR-036).
        foreach (self::workflowsUsing($source, array_keys($successors)) as $workflow) {
            $this->turnOff($workflow, $mover, Deployment::STOPPED_DEVICE_MOVED);
        }
    }

    /**
     * Turns on each moved automation that arrives running, once every device it binds is
     * active in the target. One that can't start stays off and says why, for **Done**.
     */
    public function start(DeviceMove $move): void
    {
        DB::transaction(function () use ($move): void {
            $target = Organization::find($move->target_organization_id);
            $mover = User::find($move->mover_id);
            if (! $target) {
                return;
            }
            $items = DeviceMoveItem::where('device_move_id', $move->id)->where('kind', 'automation')->where('action', 'move')
                ->where('arrives_running', true)->whereNull('attention')->lockForUpdate()->get();
            foreach ($items as $item) {
                $workflow = Workflow::whereKey($item->target_item_id)->where('organization_id', $target->id)->lockForUpdate()->first();
                // Someone turned it on, or archived it, before its devices were ready.
                if (! $workflow || $workflow->deployment_generation > 0 || $workflow->isArchived()) {
                    continue;
                }
                $bound = Device::where('organization_id', $target->id)->whereIn('uuid', WorkflowRewrite::devices($workflow->workflow ?? []))->get()->keyBy('uuid');
                if ($bound->contains(fn (Device $device): bool => $device->deployment_status === 'pending')) {
                    continue;
                }
                $why = $this->startRefusal($workflow, $bound, $target, $mover);
                if ($why === null) {
                    try {
                        app(DagDeployment::class)->request($workflow, ['operation_uuid' => (string) Str::uuid(), 'target_state' => 'active', 'draft_revision' => $workflow->draft_revision, 'expected_generation' => $workflow->deployment_generation], $mover);

                        continue;
                    } catch (HttpExceptionInterface|ValidationException $exception) {
                        $why = 'it could not be turned on: '.rtrim($exception instanceof ValidationException ? (string) collect($exception->errors())->flatten()->first() : $exception->getMessage(), '.');
                    }
                }
                $item->update(['arrives_running' => false, 'attention' => 'Turn it on in '.$target->name.': '.$why.'.']);
            }
        });
    }

    /**
     * Whether a successor's runtime answer may let a moved automation start.
     */
    public static function waiting(int $moveId): bool
    {
        return DeviceMoveItem::where('device_move_id', $moveId)->where('kind', 'automation')->where('action', 'move')->where('arrives_running', true)->whereNull('attention')
            ->whereIn('target_item_id', Workflow::where('deployment_generation', 0)->select('id'))->exists();
    }

    /**
     * The organizations the automations moved to, for those a move archived as moved.
     *
     * @param  list<int>  $ids  workflow ids
     * @return array<int, string> organization names by workflow id
     */
    public static function movedTo(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        return DeviceMoveItem::query()->join('device_moves', 'device_moves.id', '=', 'device_move_items.device_move_id')
            ->join('organizations', 'organizations.id', '=', 'device_moves.target_organization_id')
            ->where('device_move_items.kind', 'automation')->where('device_move_items.action', 'move')->whereIn('device_move_items.source_item_id', $ids)
            ->pluck('organizations.name', 'device_move_items.source_item_id')->all();
    }

    /**
     * The source's dashboards that name any of the devices, by name.
     *
     * @param  list<string>  $uuids
     * @return Models<int, Dashboard>
     */
    private static function dashboardsUsing(Organization $source, array $uuids): Models
    {
        $wanted = array_flip($uuids);

        return Dashboard::where('organization_id', $source->id)->whereNull('archived_at')->orderBy('name')->orderBy('id')->get()
            ->filter(fn (Dashboard $dashboard): bool => collect(DashboardRewrite::devices($dashboard->widgets ?? []))->contains(fn (string $uuid): bool => isset($wanted[$uuid])))->values();
    }

    /**
     * The source's automations that bind any of the devices, by name. Geofence workflows end
     * with their assignment (research R7) and are not among them.
     *
     * @param  list<string>  $uuids
     * @return Models<int, Workflow>
     */
    private static function workflowsUsing(Organization $source, array $uuids): Models
    {
        $wanted = array_flip($uuids);

        return Workflow::where('organization_id', $source->id)->where('workflow->schema_version', 'automation-workflow.v2')->whereNull('archived_at')->orderBy('name')->orderBy('id')->get()
            ->filter(fn (Workflow $workflow): bool => collect(WorkflowRewrite::devices($workflow->workflow ?? []))->contains(fn (string $uuid): bool => isset($wanted[$uuid])))->values();
    }

    /**
     * Whether the item uses only moving devices, and its other devices of the source.
     * References to devices that no longer exist don't count.
     *
     * @param  list<string>  $devices
     * @param  Collection<string, Device>  $moving
     * @param  Collection<string, Device>  $known
     * @return array{0: bool, 1: Collection<string, Device>}
     */
    private static function classify(array $devices, Collection $moving, Collection $known): array
    {
        $others = collect($devices)->filter(fn (string $uuid): bool => $known->has($uuid) && ! $moving->has($uuid))->mapWithKeys(fn (string $uuid): array => [$uuid => $known[$uuid]]);

        return [$others->isEmpty(), $others];
    }

    /**
     * @param  list<string>  $actions  in order, the first preselected
     * @param  array<string, bool>  $allowed  the permission each action needs
     * @return list<string>
     */
    private function offered(array $actions, array $allowed): array
    {
        return array_values(array_filter($actions, fn (string $action): bool => $allowed[$action] ?? true));
    }

    /** @param  list<string>  $actions */
    private static function choose(array $actions, ?string $wanted): string
    {
        return $wanted !== null && in_array($wanted, $actions, true) ? $wanted : $actions[0];
    }

    /**
     * Adding the other devices to the move (FR-031): possible when none is archived and
     * the move stays within its limit.
     *
     * @param  Collection<string, Device>  $others
     * @param  Collection<string, Device>  $moving
     * @return array{count: int, can_add: bool, device_uuids: list<string>}
     */
    private static function others(Collection $others, Collection $moving): array
    {
        $addable = $others->every(fn (Device $device): bool => $device->lifecycle !== 'archived') && $moving->count() + $others->count() <= MovePreview::LIMIT;

        return ['count' => $others->count(), 'can_add' => $addable, 'device_uuids' => $addable ? $others->keys()->values()->all() : []];
    }

    /**
     * Why a running automation that moves arrives off, or null when it keeps running
     * (FR-035).
     *
     * @param  array<string, bool>  $can
     */
    private function offReason(Workflow $workflow, Organization $target, array $can, ?string $inactive): ?string
    {
        return match (true) {
            WorkflowRewrite::commands($workflow->workflow ?? []) => 'it sends device commands',
            ! $can['enabled'] => 'automations are turned off in '.$target->name,
            ! $can['activate'] => 'you can’t turn on automations in '.$target->name,
            $inactive !== null => $inactive.' arrives inactive',
            default => null,
        };
    }

    private static function automationsOn(Organization $organization): bool
    {
        return DB::table('automation_settings')->where('organization_id', $organization->id)->where('enabled', true)->where('stopped', false)->exists();
    }

    /**
     * The alert recipients who would lose the automation: everyone but verified members of
     * the target who can view its devices.
     *
     * @return list<string>
     */
    private function lostRecipients(Workflow $workflow, Organization $target): array
    {
        $ids = $workflow->notification_settings['recipient_ids'] ?? [];
        $kept = $this->recipients($ids, $target)->modelKeys();

        return User::whereIn('id', array_diff($ids, $kept))->orderBy('name')->pluck('name')->all();
    }

    /**
     * @param  list<int>  $ids
     * @return Models<int, User>
     */
    private function recipients(array $ids, Organization $target): Models
    {
        return User::whereIn('id', $ids)->whereNotNull('email_verified_at')->whereHas('organizations', fn ($query) => $query->where('organizations.id', $target->id))->get()
            ->filter(fn (User $user): bool => $this->authorization->capabilities($user, $target)['view'])->values();
    }

    /**
     * Shares that can't come along: every role share, since roles belong to one
     * organization, and user shares of people who aren't members of the target.
     *
     * @param  list<int>  $members
     * @return list<string>
     */
    private function lostShares(Dashboard $dashboard, array $members): array
    {
        return DashboardShare::where('dashboard_id', $dashboard->id)->where(fn ($query) => $query->whereNotNull('role_id')->orWhereNotIn('user_id', $members))->with(['role', 'user'])->get()
            ->map(fn (DashboardShare $share): string => $share->role_id ? 'Role '.($share->role?->display_name ?? $share->role?->name) : (string) $share->user?->name)
            ->sort()->values()->all();
    }

    /**
     * What a rewrite leaves out, as the review lists it.
     *
     * @param  array{panels: list<array{id: string, title: string, devices: list<string>}>, sources: list<array{panel: string, device_uuid: string}>, references: list<array{panel: string, kind: string, uuid: string}>}  $omitted
     * @param  Collection<string, Device>  $known
     * @return array{panels: list<string>, references: list<string>}
     */
    private function describe(array $omitted, Organization $source, Collection $known): array
    {
        $name = fn (string $uuid): string => $known[$uuid]->name ?? 'a removed device';
        $references = collect($omitted['references']);
        $fences = Geofence::where('organization_id', $source->id)->whereIn('uuid', $references->where('kind', 'geofence')->pluck('uuid'))->pluck('name', 'uuid');
        $flows = Workflow::where('organization_id', $source->id)->whereIn('uuid', $references->where('kind', 'workflow')->pluck('uuid'))->pluck('name', 'uuid');

        return [
            'panels' => [
                ...array_map(fn (array $panel): string => $panel['title'].($panel['devices'] ? ' ('.implode(', ', array_map($name, $panel['devices'])).')' : ''), $omitted['panels']),
                ...array_map(fn (array $source): string => $source['panel'].' without '.$name($source['device_uuid']), $omitted['sources']),
            ],
            'references' => $references->map(fn (array $reference): string => $reference['panel'].': '.($reference['kind'] === 'geofence'
                ? 'geofence '.($fences[$reference['uuid']] ?? '')
                : 'automation '.($flows[$reference['uuid']] ?? '')))->map(fn (string $text): string => rtrim($text))->values()->all(),
        ];
    }

    /**
     * Recreates the automation in the target on the successors, then turns the source's
     * off and archives it as moved. Returns the new automation's UUID.
     *
     * @param  array<string, array{device_uuid: string, configuration_uuid: string, generation: int}>  $bindings
     * @param  array<string, string>  $parameters
     */
    private function moveAutomation(DeviceMoveItem $item, Workflow $workflow, DeviceMove $move, Organization $source, Organization $target, User $mover, array $bindings, array $parameters): string
    {
        $uuid = (string) Str::uuid();
        $graph = WorkflowRewrite::rewrite($workflow->workflow ?? [], ['uuid' => $uuid, 'version_uuid' => (string) Str::uuid(), 'organization_uuid' => $target->uuid], $bindings, $parameters)['workflow'];
        $settings = $workflow->notification_settings;
        if ($settings !== null) {
            $kept = $this->recipients($settings['recipient_ids'] ?? [], $target)->modelKeys();
            $settings = [...$settings, 'recipient_ids' => $kept, 'enabled' => ($settings['enabled'] ?? false) && $kept !== []];
        }
        $moved = Workflow::create([
            'uuid' => $uuid, 'organization_id' => $target->id, 'name' => $workflow->name, 'draft_revision' => 1,
            'workflow' => $graph, 'definition' => $graph, 'definition_hash' => hash('sha256', $this->canonical->encode($graph)),
            'layout' => $workflow->layout, 'notification_settings' => $settings, 'updated_by' => $mover->id,
        ])->refresh();
        DB::table('automation_workflow_revisions')->insert(['automation_workflow_id' => $moved->id, 'revision' => 1, 'snapshot' => json_encode($moved->toArray(), JSON_THROW_ON_ERROR), 'created_by' => $mover->id, 'created_at' => now()]);

        $running = $workflow->desired_deployment_uuid !== null;
        $this->turnOff($workflow, $mover, Deployment::STOPPED_MOVED);
        $this->archive($workflow, $move, $mover);
        $inactive = collect($graph['bindings'])->first(fn (array $binding): bool => $binding['configuration_uuid'] === self::NO_CONFIGURATION && in_array($binding['device_uuid'], array_column($bindings, 'device_uuid'), true));
        $capabilities = $this->automations->capabilities($mover, $target);
        $why = $running ? $this->offReason($moved, $target, ['enabled' => self::automationsOn($target), 'activate' => $capabilities['activate']],
            $inactive ? Device::where('uuid', $inactive['device_uuid'])->value('name') : null) : null;
        $item->update(['target_item_id' => $moved->id, 'arrives_running' => $running && $why === null,
            'attention' => $why === null ? null : 'Turn it on in '.$target->name.': it arrived off because '.$why.'.']);
        ActivityLog::record('workflow.moved_out', $source, $mover, $workflow, ['target' => $target->name, 'move_uuid' => $move->uuid]);
        ActivityLog::record('workflow.moved_in', $target, $mover, $moved, ['source' => $source->name, 'move_uuid' => $move->uuid]);

        return $moved->uuid;
    }

    /**
     * Requests the automation's deactivation, unless it is off or a deployment is pending:
     * a pending deactivation turns it off anyway, and the runtime refuses a pending
     * activation bound to a stopped device. `$reason` is why it stops (`moved`,
     * `device_moved`), recorded on the deactivation.
     */
    private function turnOff(Workflow $workflow, User $mover, ?string $reason): void
    {
        $workflow = Workflow::whereKey($workflow->id)->lockForUpdate()->firstOrFail();
        if ($workflow->pending_operation_uuid !== null || ($workflow->desired_deployment_uuid === null && $workflow->applied_deployment_uuid === null)) {
            return;
        }
        app(DagDeployment::class)->request($workflow, ['operation_uuid' => (string) Str::uuid(), 'target_state' => 'inactive', 'draft_revision' => $workflow->draft_revision, 'expected_generation' => $workflow->deployment_generation], $mover, $reason);
    }

    /** Archives a dashboard or automation as this move's, keeping when it last changed. */
    private function archive(Dashboard|Workflow $model, DeviceMove $move, User $mover): void
    {
        $model::whereKey($model->id)->toBase()->update(['archived_at' => now(), 'archived_by' => $mover->id, 'archived_by_move_id' => $move->id]);
    }

    /**
     * Moves the dashboard to the target on the successors, with its revisions. User shares
     * of target members and its owner, when a member, come along; the mover owns it
     * otherwise.
     *
     * @param  array<string, string>  $devices
     * @param  array<string, string>  $parameters
     * @param  array<string, string>  $references
     */
    private function moveDashboard(DeviceMoveItem $item, Dashboard $dashboard, DeviceMove $move, Organization $source, Organization $target, User $mover, array $devices, array $parameters, array $references): void
    {
        $members = $target->users()->pluck('users.id')->all();
        $rewritten = DashboardRewrite::rewrite($dashboard->widgets ?? [], $dashboard->layouts ?? [], $devices, $parameters, $references, false);
        foreach (DashboardRevision::where('dashboard_id', $dashboard->id)->get() as $revision) {
            $earlier = DashboardRewrite::rewrite($revision->widgets ?? [], $revision->layouts ?? [], $devices, $parameters, $references, false);
            $revision->update(['widgets' => $earlier['widgets'], 'layouts' => $earlier['layouts']]);
        }
        DashboardShare::where('dashboard_id', $dashboard->id)->where(fn ($query) => $query->whereNotNull('role_id')->orWhereNotIn('user_id', $members))->delete();
        DB::table('dashboard_user')->where('dashboard_id', $dashboard->id)->whereNotIn('user_id', $members)->delete();
        $dashboard->timestamps = false;
        $dashboard->update(['organization_id' => $target->id, 'widgets' => $rewritten['widgets'], 'layouts' => $rewritten['layouts'],
            'created_by' => in_array($dashboard->created_by, $members, true) ? $dashboard->created_by : $mover->id]);
        $item->update(['target_item_id' => $dashboard->id]);
        ActivityLog::record('dashboard.moved_out', $source, $mover, $dashboard, ['target' => $target->name, 'move_uuid' => $move->uuid]);
        ActivityLog::record('dashboard.moved_in', $target, $mover, $dashboard, ['source' => $source->name, 'move_uuid' => $move->uuid]);
    }

    /**
     * A target dashboard with the panels and sources of the moving devices only, owned by
     * the mover and shared with no one. The original is untouched.
     *
     * @param  array<string, string>  $devices
     * @param  array<string, string>  $parameters
     * @param  array<string, string>  $references
     */
    private function copyDashboard(DeviceMoveItem $item, Dashboard $dashboard, DeviceMove $move, Organization $target, User $mover, array $devices, array $parameters, array $references): void
    {
        $rewritten = DashboardRewrite::rewrite($dashboard->widgets ?? [], $dashboard->layouts ?? [], $devices, $parameters, $references, true);
        $copy = Dashboard::create([
            'organization_id' => $target->id, 'name' => $dashboard->name, 'widgets' => $rewritten['widgets'], 'layouts' => $rewritten['layouts'],
            'defaults' => $dashboard->defaults, 'tags' => $dashboard->tags ?? [], 'folder' => $dashboard->folder, 'revision' => 1,
            'access' => DashboardAccess::RESTRICTED, 'created_by' => $mover->id, 'updated_by' => $mover->id,
        ]);
        app(SaveDashboard::class)->snapshot($copy);
        $item->update(['target_item_id' => $copy->id]);
        ActivityLog::record('dashboard.created', $target, $mover, $copy, ['move_uuid' => $move->uuid, 'copied_from' => $dashboard->name]);
    }

    /**
     * Why a moved automation can't start yet, as a clause, or null.
     *
     * @param  Collection<string, Device>  $bound
     */
    private function startRefusal(Workflow $workflow, Collection $bound, Organization $target, ?User $mover): ?string
    {
        if (! $mover || ! $this->automations->capabilities($mover, $target)['activate']) {
            return 'you can’t turn on automations there';
        }
        if (! self::automationsOn($target)) {
            return 'automations are turned off there';
        }
        foreach ($workflow->workflow['bindings'] ?? [] as $binding) {
            $device = $bound->get($binding['device_uuid']);
            if (! $device || $device->lifecycle !== 'active' || ! in_array($device->deployment_status, ['applied', 'failed'], true)) {
                return ($device->name ?? 'a device it uses').' isn’t active there';
            }
            if ($device->applied_configuration_uuid !== $binding['configuration_uuid'] || $device->applied_generation !== $binding['generation']) {
                return $device->name.' changed since it arrived, so check the automation first';
            }
        }

        return null;
    }

    /** @param  list<string>  $names */
    private static function names(array $names): string
    {
        $names = array_values(array_unique($names));

        return count($names) < 2 ? ($names[0] ?? 'the moved devices') : implode(', ', array_slice($names, 0, -1)).' and '.end($names);
    }
}
