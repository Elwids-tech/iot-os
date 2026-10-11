<?php

declare(strict_types=1);

namespace App\Domain\Devices\Http\Controllers;

use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceCommand;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Devices\Services\DeviceCommandService;
use App\Domain\Devices\Services\DeviceView;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class CommandController
{
    public function __construct(private readonly DeviceAuthorization $authorization, private readonly DeviceCommandService $commands) {}

    public function index(Request $request, Organization $organization, Device $device): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization, $device);
        $this->commands->expire($device);

        return ['data' => $device->commands()->with('configuration')->orderByDesc('id')->limit(100)->get()->map(fn ($c) => DeviceView::command($c))];
    }

    public function prepare(Request $request, Organization $organization, Device $device)
    {
        $this->authorization->authorize($request->user(), DevicePermission::COMMAND, $organization, $device);
        $values = $request->validate(['configuration_uuid' => ['required', 'uuid'], 'parameter_uuid' => ['required', 'uuid'], 'idempotency_key' => ['required', 'uuid'], 'value' => ['present']]);

        return response()->json(['data' => DeviceView::command($this->commands->prepare($device, $values, $request->user()->id))], 201);
    }

    public function send(Request $request, Organization $organization, Device $device)
    {
        $this->authorization->authorize($request->user(), DevicePermission::COMMAND, $organization, $device);
        $values = $request->validate(['configuration_uuid' => ['required', 'uuid'], 'parameter_uuid' => ['required', 'uuid'], 'idempotency_key' => ['required', 'uuid'], 'value' => ['present']]);

        return response()->json(['data' => DeviceView::command($this->commands->send($device, $values, $request->user()->id))], 201);
    }

    public function confirm(Request $request, Organization $organization, Device $device, DeviceCommand $command): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::COMMAND, $organization, $device);
        abort_unless($command->device_id === $device->id, 404);
        $request->validate(['confirmed' => ['required', 'accepted']]);

        return ['data' => DeviceView::command($this->commands->confirm($device, $command, $request->user()->id))];
    }

    public function cancel(Request $request, Organization $organization, Device $device, DeviceCommand $command): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::COMMAND, $organization, $device);
        abort_unless($command->device_id === $device->id && $command->created_by === $request->user()->id, 404);
        DB::transaction(function () use ($device, $command, $request): void {
            Device::whereKey($device->id)->lockForUpdate()->firstOrFail();
            $command->refresh();
            abort_unless($command->status === 'prepared', 409, 'Only an unconfirmed command can be cancelled.');
            $command->update(['status' => 'cancelled', 'outstanding_key' => null, 'completed_at' => now()]);
            DeviceAudit::record('command.cancelled', $device->organization_id, $request->user()->id, $command->uuid);
        });

        return ['data' => DeviceView::command($command)];
    }
}
