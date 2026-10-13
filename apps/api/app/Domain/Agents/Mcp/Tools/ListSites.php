<?php

declare(strict_types=1);

namespace App\Domain\Agents\Mcp\Tools;

use App\Domain\Agents\Mcp\AgentContext;
use App\Domain\Agents\Mcp\AgentTool;
use App\Domain\Agents\Mcp\PortalUrls;
use App\Domain\Devices\Models\Site;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Tools\Annotations\IsIdempotent;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Description('The organization\'s sites with their time zones and how many devices each holds. Use a site_uuid to filter find_devices or list_alerts.')]
#[IsReadOnly]
#[IsIdempotent]
#[IsOpenWorld(false)]
final class ListSites extends AgentTool
{
    protected string $name = 'list_sites';

    protected ?string $permission = 'Device.view';

    public function schema(JsonSchema $schema): array
    {
        return [];
    }

    protected function run(Request $request, AgentContext $context): array
    {
        app(DeviceAuthorization::class)->authorize($context->user, DevicePermission::VIEW, $context->organization);
        $urls = app(PortalUrls::class);

        return ['data' => [
            'organization_timezone' => $context->organization->timezone,
            'sites' => Site::where('organization_id', $context->organization->id)->withCount('devices')->orderBy('name')->limit(200)->get()
                ->map(fn (Site $site): array => ['uuid' => $site->uuid, 'name' => $site->name, 'timezone' => $site->timezone, 'devices_count' => $site->devices_count, 'portal_url' => $urls->organization($context->organization, 'sites')])
                ->values()->all(),
        ]];
    }
}
