<?php

declare(strict_types=1);

namespace App\Domain\Automation\Http\Controllers;

use App\Domain\Automation\Jobs\DeliverAlertEmail;
use App\Domain\Automation\Models\Alert;
use App\Domain\Automation\Models\AlertDelivery;
use App\Domain\Automation\Services\AlertQuery;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Integrations\Services\EventJournal;
use App\Domain\Shared\Models\Organization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

final class AlertController
{
    public function __construct(private readonly DeviceAuthorization $authorization) {}

    public function index(Request $request, Organization $organization): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization);
        $input = $request->validate(['condition' => 'sometimes|in:active,cleared', 'acknowledged' => 'sometimes|boolean', 'device' => 'sometimes|uuid', 'workflow' => 'sometimes|uuid', 'assignee' => 'sometimes|integer|min:1', 'group' => 'sometimes|in:source', 'page' => 'sometimes|integer|min:1', 'per_page' => 'sometimes|integer|min:1|max:100']);
        $query = $this->filtered($organization, $input);
        if (isset($input['group'])) {
            return $this->sources($organization, $query, $request->integer('per_page', 25));
        }
        $page = $query->orderByDesc('id')->paginate($request->integer('per_page', 25));

        return ['data' => $this->views($organization, $page->getCollection()), 'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()]];
    }

    public function show(Request $request, Organization $organization, Alert $alert): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization, $alert);

        return ['data' => $this->views($organization, $alert->newCollection([$alert]))[0]];
    }

    public function acknowledge(Request $request, Organization $organization, Alert $alert): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization, $alert);
        $alert = DB::transaction(function () use ($alert, $request) {
            $locked = Alert::whereKey($alert->id)->lockForUpdate()->firstOrFail();
            $this->acknowledgeLocked($locked, $request->user()->id);

            return $locked;
        });

        return ['data' => $this->views($organization, $alert->newCollection([$alert]))[0]];
    }

    /** Acknowledges listed alerts, or every unacknowledged alert of one workflow and device. Already acknowledged alerts are left as they are. */
    public function acknowledgeMany(Request $request, Organization $organization): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization);
        $input = $request->validate([
            'alert_uuids' => 'required_without:workflow_uuid|prohibits:workflow_uuid,device_uuid,condition,assignee|array|min:1|max:500',
            'alert_uuids.*' => 'uuid|distinct',
            'workflow_uuid' => 'required_without:alert_uuids|uuid',
            'device_uuid' => 'required_with:workflow_uuid|uuid',
            'condition' => 'sometimes|in:active,cleared',
            'assignee' => 'sometimes|integer|min:1',
        ]);
        if (isset($input['alert_uuids'])) {
            $ids = Alert::where('organization_id', $organization->id)->whereIn('uuid', $input['alert_uuids'])->pluck('id');
            // All or nothing: an alert of another organization is indistinguishable from a missing one.
            abort_unless($ids->count() === count($input['alert_uuids']), 404);
        } else {
            $ids = $this->filtered($organization, ['workflow' => $input['workflow_uuid'], 'device' => $input['device_uuid'], 'acknowledged' => false, ...array_intersect_key($input, array_flip(['condition', 'assignee']))])->orderBy('automation_alerts.id')->pluck('automation_alerts.id');
        }
        $acknowledged = 0;
        foreach ($ids->chunk(500) as $chunk) {
            $acknowledged += DB::transaction(function () use ($chunk, $request): int {
                $alerts = Alert::whereIn('id', $chunk)->whereNull('acknowledged_at')->orderBy('id')->lockForUpdate()->get()->load(['workflow', 'deployment']);
                foreach ($alerts as $alert) {
                    $this->acknowledgeLocked($alert, $request->user()->id, ['bulk' => true]);
                }

                return $alerts->count();
            });
        }

        return ['data' => ['acknowledged' => $acknowledged]];
    }

    // The caller holds the alert row lock inside the transaction.
    private function acknowledgeLocked(Alert $locked, int $user, array $details = []): void
    {
        if ($locked->acknowledged_at) {
            return;
        }
        $locked->update(['acknowledged_by' => $user, 'acknowledged_at' => now()]);
        EventJournal::alert($locked, 'acknowledged');
        DeviceAudit::record('alert.acknowledged', $locked->organization_id, $user, $locked->uuid, $details);
    }

    public function assign(Request $request, Organization $organization, Alert $alert): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization, $alert);
        $input = $request->validate(['user_id' => ['present', 'nullable', 'integer', Rule::exists('organization_user', 'user_id')->where('organization_id', $organization->id)]], ['user_id.exists' => 'Choose a member of this organization.']);
        DB::transaction(function () use ($alert, $input, $request): void {
            $alert->update(['assigned_to' => $input['user_id'], 'assigned_at' => $input['user_id'] === null ? null : now()]);
            DeviceAudit::record('alert.assigned', $alert->organization_id, $request->user()->id, $alert->uuid, ['assigned_to' => $input['user_id']]);
        });

        return ['data' => $this->views($organization, $alert->newCollection([$alert]))[0]];
    }

    public function comments(Request $request, Organization $organization, Alert $alert): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization, $alert);
        $request->validate(['page' => 'sometimes|integer|min:1']);
        $page = DB::table('automation_alert_comments')->join('users', 'users.id', '=', 'automation_alert_comments.created_by')->where('automation_alert_id', $alert->id)->orderBy('automation_alert_comments.id')->paginate(50, ['automation_alert_comments.uuid', 'created_by', 'body', 'automation_alert_comments.created_at', 'users.name as author_name']);

        return ['data' => $page->items(), 'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()]];
    }

    public function comment(Request $request, Organization $organization, Alert $alert)
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization, $alert);
        $input = $request->validate(['uuid' => 'required|uuid', 'body' => 'required|string|max:5000']);
        $comment = DB::transaction(function () use ($alert, $input, $request) {
            Alert::whereKey($alert->id)->lockForUpdate()->firstOrFail();
            $existing = DB::table('automation_alert_comments')->where('uuid', $input['uuid'])->first();
            if ($existing) {
                abort_unless($existing->automation_alert_id === $alert->id && $existing->created_by === $request->user()->id && $existing->body === $input['body'], 409, 'Comment identity was already used.');

                return $input;
            }
            DB::table('automation_alert_comments')->insert([...$input, 'automation_alert_id' => $alert->id, 'created_by' => $request->user()->id, 'created_at' => now()]);
            DeviceAudit::record('alert.commented', $alert->organization_id, $request->user()->id, $alert->uuid, ['comment_uuid' => $input['uuid']]);

            return $input;
        });

        return response()->json(['data' => $comment], 201);
    }

    public function deliveries(Request $request, Organization $organization, Alert $alert): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization, $alert);

        return ['data' => AlertDelivery::where('automation_alert_id', $alert->id)->with('recipient')->orderBy('id')->get()->map(fn ($d) => [...$d->only(['uuid', 'recipient_id', 'type', 'status', 'attempts', 'diagnostic', 'sent_at', 'retry_generation']), 'recipient_name' => $d->recipient->name, 'history' => DB::table('automation_alert_delivery_attempts')->where('automation_alert_delivery_id', $d->id)->orderBy('id')->get(['attempt', 'status', 'created_at'])])];
    }

    public function retry(Request $request, Organization $organization, Alert $alert, string $delivery)
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization, $alert);
        $input = $request->validate(['retry_generation' => 'required|integer|min:0']);
        DB::transaction(function () use ($alert, $delivery, $input, $request): void {
            $locked = AlertDelivery::where('automation_alert_id', $alert->id)->where('uuid', $delivery)->lockForUpdate()->firstOrFail();
            abort_unless($locked->status === 'failed' && (int) $locked->retry_generation === (int) $input['retry_generation'], 409, 'Delivery changed. Reload its status before retrying.');
            $locked->update(['status' => 'pending', 'diagnostic' => null, 'cycle_attempts' => 0, 'retry_generation' => $locked->retry_generation + 1]);
            DeliverAlertEmail::dispatch($locked->uuid, (int) $locked->retry_generation)->onConnection('alerts')->onQueue('alerts');
            DeviceAudit::record('alert.delivery_retried', $alert->organization_id, $request->user()->id, $alert->uuid, ['delivery_uuid' => $locked->uuid, 'retry_generation' => $locked->retry_generation]);
        });

        return response()->json(['data' => ['status' => 'pending']], 202);
    }

    private function filtered(Organization $organization, array $input): Builder
    {
        return app(AlertQuery::class)->filtered($organization, $input);
    }

    private static function device(): string
    {
        return AlertQuery::device();
    }

    /** One row per workflow and device: the latest matching alert with counts over the matching alerts. */
    private function sources(Organization $organization, Builder $query, int $perPage): array
    {
        $device = self::device();
        $page = $query->toBase()
            ->join('automation_deployments', 'automation_deployments.id', '=', 'automation_alerts.automation_deployment_id')
            ->selectRaw('automation_alerts.automation_workflow_id, max(automation_alerts.id) as latest_id, count(*) as occurrences, '
                .'sum(case when automation_alerts.acknowledged_at is null then 1 else 0 end) as unacknowledged, '
                .'sum(case when automation_alerts.cleared_at is null then 1 else 0 end) as active, '
                .'min(automation_alerts.activated_at) as first_activated_at, max(automation_alerts.activated_at) as last_activated_at')
            ->groupBy('automation_alerts.automation_workflow_id')->groupByRaw($device)
            ->orderByDesc('latest_id')
            ->paginate($perPage);
        $latest = Alert::whereIn('id', array_column($page->items(), 'latest_id'))->get();
        $views = array_combine($latest->modelKeys(), $this->views($organization, $latest));
        $time = fn (?string $value) => $value === null ? null : CarbonImmutable::parse($value)->toJSON();

        return ['data' => array_map(fn ($row) => [
            'workflow_uuid' => $views[$row->latest_id]['workflow_uuid'], 'device_uuid' => $views[$row->latest_id]['device_uuid'],
            'occurrences' => (int) $row->occurrences, 'unacknowledged' => (int) $row->unacknowledged, 'active' => (int) $row->active,
            'first_activated_at' => $time($row->first_activated_at), 'last_activated_at' => $time($row->last_activated_at),
            'latest' => $views[$row->latest_id],
        ], $page->items()), 'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()]];
    }

    private function views(Organization $organization, Collection $alerts): array
    {
        return app(AlertQuery::class)->views($organization, $alerts);
    }
}
