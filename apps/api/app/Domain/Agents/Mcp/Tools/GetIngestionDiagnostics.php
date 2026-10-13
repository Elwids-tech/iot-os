<?php

declare(strict_types=1);

namespace App\Domain\Agents\Mcp\Tools;

use App\Domain\Agents\Mcp\AgentContext;
use App\Domain\Agents\Mcp\AgentTool;
use App\Domain\Agents\Mcp\PortalUrls;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Devices\Services\DeviceReadings;
use App\Domain\Devices\Services\IngestionDiagnostics;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Tools\Annotations\IsIdempotent;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

#[Description('Why a device (or an adapter) is or is not delivering data: lifecycle, configuration state, source and gateway presence, last reading, whether the source changed and needs review, announced metrics that are not mapped, current reading quality, and for adapters their status, connectivity and decoder tests. Each check is ok, problem or unknown with a detail. Pass device_uuid or adapter_uuid.')]
#[IsReadOnly]
#[IsIdempotent]
#[IsOpenWorld(false)]
final class GetIngestionDiagnostics extends AgentTool
{
    protected string $name = 'get_ingestion_diagnostics';

    protected ?string $permission = 'Device.view';

    public function schema(JsonSchema $schema): array
    {
        return [
            'device_uuid' => $schema->string()->format('uuid'),
            'adapter_uuid' => $schema->string()->format('uuid'),
        ];
    }

    protected function run(Request $request, AgentContext $context): array
    {
        $input = $request->validate([
            'device_uuid' => ['required_without:adapter_uuid', 'nullable', 'uuid'],
            'adapter_uuid' => ['required_without:device_uuid', 'nullable', 'uuid'],
        ]);
        app(DeviceAuthorization::class)->authorize($context->user, DevicePermission::VIEW, $context->organization);
        $diagnostics = app(IngestionDiagnostics::class);
        $urls = app(PortalUrls::class);
        if (isset($input['device_uuid'])) {
            $device = Device::where('organization_id', $context->organization->id)->where('uuid', $input['device_uuid'])->firstOrFail();
            try {
                [$latest, $error] = [app(DeviceReadings::class)->latest($context->organization, $device), null];
            } catch (HttpExceptionInterface $unavailable) {
                [$latest, $error] = [null, $unavailable->getMessage()];
            }

            return [
                'data' => ['device' => ['uuid' => $device->uuid, 'name' => $device->name], 'checks' => $diagnostics->device($device, $latest, $error), 'portal_url' => $urls->organization($context->organization, 'devices/'.$device->uuid)],
                'targets' => [$device->uuid],
            ];
        }
        abort_unless((bool) config('adapters.enabled'), 404);
        $adapter = DeviceAdapter::where('organization_id', $context->organization->id)->where('uuid', $input['adapter_uuid'])->firstOrFail();

        return [
            'data' => ['adapter' => ['uuid' => $adapter->uuid, 'name' => $adapter->name], 'checks' => $diagnostics->adapter($adapter), 'portal_url' => $urls->organization($context->organization, 'device-adapters/'.$adapter->uuid)],
            'targets' => [$adapter->uuid],
        ];
    }
}
