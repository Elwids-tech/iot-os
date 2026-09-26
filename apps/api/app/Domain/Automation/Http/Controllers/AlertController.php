<?php

declare(strict_types=1);

namespace App\Domain\Automation\Http\Controllers;

use App\Domain\Automation\Jobs\DeliverAlertEmail;
use App\Domain\Automation\Models\Alert;
use App\Domain\Automation\Models\AlertDelivery;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class AlertController
{
    public function __construct(private readonly DeviceAuthorization $authorization) {}

    public function index(Request $request, Organization $organization): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization);
        $input = $request->validate(['condition' => 'sometimes|in:active,cleared', 'acknowledged' => 'sometimes|boolean', 'page' => 'sometimes|integer|min:1', 'per_page' => 'sometimes|integer|min:1|max:100']);
        $query = Alert::where('organization_id', $organization->id)->with(['workflow', 'deployment']);
        if (isset($input['condition'])) {
            $input['condition'] === 'active' ? $query->whereNull('cleared_at') : $query->whereNotNull('cleared_at');
        }
        if (isset($input['acknowledged'])) {
            $input['acknowledged'] ? $query->whereNotNull('acknowledged_at') : $query->whereNull('acknowledged_at');
        }
        $page = $query->orderByDesc('id')->paginate($request->integer('per_page', 25));

        return ['data' => $page->getCollection()->map(fn ($a) => $this->view($a)), 'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()]];
    }

    public function show(Request $request, Organization $organization, Alert $alert): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization, $alert);

        return ['data' => $this->view($alert)];
    }

    public function acknowledge(Request $request, Organization $organization, Alert $alert): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization, $alert);
        $alert = DB::transaction(function () use ($alert, $request) {
            $locked = Alert::whereKey($alert->id)->lockForUpdate()->firstOrFail();
            if (! $locked->acknowledged_at) {
                $locked->update(['acknowledged_by' => $request->user()->id, 'acknowledged_at' => now()]);
                \App\Domain\Integrations\Services\EventJournal::alert($locked, 'acknowledged');
                DeviceAudit::record('alert.acknowledged', $locked->organization_id, $request->user()->id, $locked->uuid);
            }

            return $locked;
        });

        return ['data' => $this->view($alert)];
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

    private function view(Alert $alert): array
    {
        return [...$alert->only(['uuid', 'episode', 'activated_at', 'cleared_at', 'acknowledged_at', 'acknowledged_by', 'activation_transition_id', 'clear_transition_id']), 'workflow_uuid' => $alert->workflow->uuid, 'workflow_name' => $alert->workflow->name, 'operation_uuid' => $alert->deployment->uuid, 'device_uuid' => $alert->deployment->definition['binding']['device_uuid'], 'condition' => $alert->cleared_at ? 'cleared' : 'active', 'execution_stopped_reason' => $alert->deployment->stopped_reason];
    }
}
