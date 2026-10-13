<?php

declare(strict_types=1);

namespace App\Domain\Agents\Mcp\Tools;

use App\Domain\Agents\Mcp\AgentContext;
use App\Domain\Agents\Mcp\AgentTool;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Devices\Services\DeviceReadings;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Validation\Rule;
use Laravel\Mcp\Request;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Tools\Annotations\IsIdempotent;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Description('Readings of one device parameter over a time window (RFC 3339 from and to). kind "history" (default) returns values at observed time, bucketed to max_points; "increase" returns a counter\'s increase per calendar bucket in the device\'s reporting time zone; "state" returns durations and transitions of a boolean, enum or colour parameter. Use get_device_health for parameter uuids.')]
#[IsReadOnly]
#[IsIdempotent]
#[IsOpenWorld(false)]
final class GetMeasurements extends AgentTool
{
    protected string $name = 'get_measurements';

    protected ?string $permission = 'Device.view';

    public function schema(JsonSchema $schema): array
    {
        return [
            'device_uuid' => $schema->string()->format('uuid')->required(),
            'parameter_uuid' => $schema->string()->format('uuid')->required(),
            'from' => $schema->string()->format('date-time')->required(),
            'to' => $schema->string()->format('date-time')->required(),
            'kind' => $schema->string()->enum(['history', 'increase', 'state'])->default('history'),
            'max_points' => $schema->integer()->min(10)->max(500)->default(120),
            'bucket' => $schema->string()->enum(['15m', '1h', '1d', '1w', '1mo', '1y'])->description('Required for kind "increase".'),
        ];
    }

    protected function run(Request $request, AgentContext $context): array
    {
        $input = $request->validate([
            'device_uuid' => ['required', 'uuid'],
            'parameter_uuid' => ['required', 'uuid'],
            'from' => ['required', 'date'],
            'to' => ['required', 'date', 'after:from'],
            'kind' => ['nullable', Rule::in(['history', 'increase', 'state'])],
            'max_points' => ['nullable', 'integer', 'min:10', 'max:500'],
            'bucket' => ['required_if:kind,increase', 'nullable', Rule::in(['15m', '1h', '1d', '1w', '1mo', '1y'])],
        ]);
        $device = Device::where('organization_id', $context->organization->id)->where('uuid', $input['device_uuid'])->firstOrFail();
        app(DeviceAuthorization::class)->authorize($context->user, DevicePermission::VIEW, $context->organization, $device);
        $readings = app(DeviceReadings::class);
        $window = ['from' => $input['from'], 'to' => $input['to'], 'parameter_uuid' => $input['parameter_uuid']];
        $kind = $input['kind'] ?? 'history';
        $result = match ($kind) {
            'increase' => $readings->increase($context->organization, $device, [...$window, 'bucket' => $input['bucket']]),
            'state' => $readings->stateHistory($context->organization, $device, [...$window, 'max_points' => (int) ($input['max_points'] ?? 120)]),
            default => $readings->history($context->organization, $device, [...$window, 'max_points' => (int) ($input['max_points'] ?? 120)]),
        };

        return [
            'data' => ['kind' => $kind, 'device_uuid' => $device->uuid, 'parameter_uuid' => $input['parameter_uuid'], 'reporting_timezone' => $device->reportingTimezone(), 'result' => $result],
            'targets' => [$device->uuid],
        ];
    }
}
