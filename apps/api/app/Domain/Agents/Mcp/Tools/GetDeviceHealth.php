<?php

declare(strict_types=1);

namespace App\Domain\Agents\Mcp\Tools;

use App\Domain\Agents\Mcp\AgentContext;
use App\Domain\Agents\Mcp\AgentTool;
use App\Domain\Agents\Mcp\PortalUrls;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Devices\Services\DeviceReadings;
use App\Domain\Devices\Services\DeviceView;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Tools\Annotations\IsIdempotent;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

#[Description('One device\'s state: lifecycle, presence, last reading, configuration state, its source or gateway, and the latest value of every parameter with its quality (good, stale, invalid, inactive), age and diagnostic. Unknown values are null with a reason.')]
#[IsReadOnly]
#[IsIdempotent]
#[IsOpenWorld(false)]
final class GetDeviceHealth extends AgentTool
{
    protected string $name = 'get_device_health';

    protected ?string $permission = 'Device.view';

    public function schema(JsonSchema $schema): array
    {
        return ['device_uuid' => $schema->string()->format('uuid')->required()];
    }

    protected function run(Request $request, AgentContext $context): array
    {
        $input = $request->validate(['device_uuid' => ['required', 'uuid']]);
        $device = Device::where('organization_id', $context->organization->id)->where('uuid', $input['device_uuid'])->firstOrFail();
        app(DeviceAuthorization::class)->authorize($context->user, DevicePermission::VIEW, $context->organization, $device);
        $view = DeviceView::device($device, true);
        [$readings, $unavailable] = $this->readings($context, $device);
        $candidate = $view['candidate'];

        return [
            'data' => [
                'device' => [
                    'uuid' => $view['uuid'], 'code' => $view['code'], 'name' => $view['name'],
                    'lifecycle' => $view['lifecycle'], 'presence' => $view['presence'],
                    'last_seen_at' => $device->last_seen_at?->toIso8601String(),
                    'deployment_status' => $view['deployment_status'], 'diagnostic' => $view['diagnostic'],
                    'profile' => $view['profile'], 'site' => $view['site'] ? ['uuid' => $view['site']['uuid'], 'name' => $view['site']['name']] : null,
                    'tags' => $view['tags'], 'reporting_timezone' => $view['reporting_timezone'],
                    'applied_configuration_uuid' => $view['applied_configuration_uuid'], 'draft_revision' => $view['draft_revision'],
                ],
                'source' => $candidate === null ? null : [
                    'kind' => 'sparkplug',
                    'source_device_id' => $candidate['source_device_id'],
                    'presence' => $candidate['presence'],
                    'last_seen_at' => $candidate['last_seen_at'] ?? null,
                    'birth_revision' => $candidate['birth_revision'],
                    'gateway' => $candidate['gateway'] ? ['name' => $candidate['gateway']['name'], 'presence' => $candidate['gateway']['presence'], 'last_seen_at' => $candidate['gateway']['last_seen_at'] ?? null] : null,
                ],
                'readings' => $readings,
                'readings_unavailable' => $unavailable,
                'portal_url' => app(PortalUrls::class)->organization($context->organization, 'devices/'.$device->uuid),
            ],
            'targets' => [$device->uuid],
        ];
    }

    /** @return array{0: list<array<string, mixed>>|null, 1: string|null} */
    private function readings(AgentContext $context, Device $device): array
    {
        try {
            $latest = app(DeviceReadings::class)->latest($context->organization, $device);
        } catch (HttpExceptionInterface $unavailable) {
            return [null, $unavailable->getMessage() ?: 'The device runtime is unavailable.'];
        }

        return [collect($latest['data'] ?? [])->map(function (array $reading): array {
            $at = $reading['observed_at'] ?? $reading['received_at'] ?? null;

            return [
                'parameter_uuid' => $reading['parameter_uuid'] ?? null,
                'key' => $reading['key'] ?? null,
                'label' => $reading['label'] ?? null,
                'unit' => $reading['unit'] ?? null,
                'value' => $reading['value'] ?? null,
                'quality' => $reading['quality'] ?? null,
                'observed_at' => $reading['observed_at'] ?? null,
                'received_at' => $reading['received_at'] ?? null,
                'age_seconds' => $at ? max(0, now()->getTimestamp() - strtotime((string) $at)) : null,
                'diagnostic' => $reading['diagnostic'] ?? null,
            ];
        })->values()->all(), null];
    }
}
