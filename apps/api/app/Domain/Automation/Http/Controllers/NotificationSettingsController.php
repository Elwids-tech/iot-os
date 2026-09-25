<?php

declare(strict_types=1);

namespace App\Domain\Automation\Http\Controllers;

use App\Domain\Automation\Models\Workflow;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class NotificationSettingsController
{
    public function __construct(private readonly DeviceAuthorization $authorization) {}

    public function show(Request $request, Organization $organization, Workflow $workflow): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization, $workflow);

        return ['data' => $this->view($workflow)];
    }

    public function update(Request $request, Organization $organization, Workflow $workflow): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization, $workflow);
        $input = $request->validate(['revision' => 'required|integer|min:0', 'enabled' => 'required|boolean', 'notify_on_clear' => 'required|boolean', 'recipient_ids' => 'present|array|max:20', 'recipient_ids.*' => 'required|integer|distinct|min:1']);
        $input['recipient_ids'] = array_map('intval', $input['recipient_ids']);
        abort_if($input['enabled'] && ! $input['recipient_ids'], 422, 'Select at least one recipient.');
        foreach ($input['recipient_ids'] as $id) {
            $user = User::whereKey($id)->whereNotNull('email_verified_at')->whereHas('organizations', fn ($q) => $q->where('organizations.id', $organization->id))->first();
            abort_unless($user && $this->authorization->capabilities($user, $organization)['view'], 422, 'Recipients must be verified members with device viewing access.');
        }
        $workflow = DB::transaction(function () use ($workflow, $input, $request) {
            $locked = Workflow::whereKey($workflow->id)->lockForUpdate()->firstOrFail();
            abort_unless($locked->notification_revision === (int) $input['revision'], 409, 'Notification settings changed. Reload before saving.');
            $settings = ['enabled' => (bool) $input['enabled'], 'notify_on_clear' => (bool) $input['notify_on_clear'], 'recipient_ids' => $input['recipient_ids']];
            $locked->update(['notification_settings' => $settings, 'notification_revision' => $locked->notification_revision + 1]);
            DeviceAudit::record('workflow.notifications_updated', $locked->organization_id, $request->user()->id, $locked->uuid, $settings);

            return $locked;
        });

        return ['data' => $this->view($workflow)];
    }

    public function recipients(Request $request, Organization $organization, Workflow $workflow): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization, $workflow);
        $request->validate(['search' => 'sometimes|nullable|string|max:255', 'page' => 'sometimes|integer|min:1']);
        $page = $organization->users()->whereNotNull('email_verified_at')->when($request->input('search'), fn ($q, $search) => $q->where('name', 'like', '%'.$search.'%'))->orderBy('users.id')->paginate(50);

        return ['data' => $page->getCollection()->filter(fn ($u) => $this->authorization->capabilities($u, $organization)['view'])->values()->map(fn ($u) => $u->only(['id', 'name', 'email'])), 'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage()]];
    }

    private function view(Workflow $workflow): array
    {
        return ['workflow_name' => $workflow->name, 'recipients' => User::whereIn('id', $workflow->notification_settings['recipient_ids'] ?? [])->get(['id', 'name'])->toArray(), 'revision' => $workflow->notification_revision ?? 0, ...($workflow->notification_settings ?? ['enabled' => false, 'notify_on_clear' => false, 'recipient_ids' => []])];
    }
}
