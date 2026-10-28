<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Http;

use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\DeviceAdapters\Models\PollRun;
use App\Domain\DeviceAdapters\Services\AdapterDiagnostics;
use App\Domain\DeviceAdapters\Services\PollingService;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;

/** Fetch now, poll runs, cursor resets and resuming (spec 020, US3 and US5). */
final class PollingController
{
    public function __construct(private readonly PollingService $polling, private readonly DeviceAuthorization $authorization) {}

    private function authorize(Request $r, Organization $organization, DeviceAdapter $adapter, DevicePermission ...$permissions): void
    {
        abort_unless(config('adapters.enabled'), 404);
        foreach ($permissions as $permission) {
            $this->authorization->authorize($r->user(), $permission, $organization, $adapter);
        }
    }

    public function fetch(Request $r, Organization $organization, DeviceAdapter $adapter): array
    {
        $this->authorize($r, $organization, $adapter, DevicePermission::CONNECTIONS);
        $revision = $r->validate(['draft_revision' => 'required|integer|min:1'])['draft_revision'];
        abort_unless($adapter->draft_revision === $revision, 409, 'Save the draft before Fetch now.');

        return ['data' => $this->polling->fetch($adapter)];
    }

    public function runs(Request $r, Organization $organization, DeviceAdapter $adapter): array
    {
        $this->authorize($r, $organization, $adapter, DevicePermission::VIEW);

        return ['data' => PollRun::where('device_adapter_id', $adapter->id)->latest('started_at')->limit(20)->get()->map(fn (PollRun $run) => $run->view()), 'polling' => app(AdapterDiagnostics::class)->polling($adapter)];
    }

    public function cursor(Request $r, Organization $organization, DeviceAdapter $adapter)
    {
        $this->authorize($r, $organization, $adapter, DevicePermission::CONNECTIONS, DevicePermission::MANAGE);
        $v = $r->validate(['request_uuid' => 'required|uuid', 'start_at' => 'required|date']);
        $operation = $this->polling->reset($adapter, $v['start_at'], $r->user()->id, $v['request_uuid']);

        return response()->json(['data' => $operation->only(['uuid', 'action', 'status', 'revision_uuid'])], 202);
    }

    public function resume(Request $r, Organization $organization, DeviceAdapter $adapter)
    {
        $this->authorize($r, $organization, $adapter, DevicePermission::CONNECTIONS, DevicePermission::MANAGE);
        $v = $r->validate(['request_uuid' => 'required|uuid']);
        $operation = $this->polling->resume($adapter, $r->user()->id, $v['request_uuid']);

        return response()->json(['data' => $operation->only(['uuid', 'action', 'status', 'revision_uuid'])], 202);
    }
}
