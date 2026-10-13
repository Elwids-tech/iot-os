<?php

declare(strict_types=1);

namespace App\Domain\Agents\Mcp\Tools;

use App\Domain\Agents\Mcp\AgentContext;
use App\Domain\Agents\Mcp\AgentTool;
use App\Domain\Agents\Mcp\PortalUrls;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Overview\OverviewQuery;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Tools\Annotations\IsIdempotent;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Description('What needs attention in the organization: device counts by state (online, offline, unknown, silent for 24 hours, registered, deactivated), active alerts, automation states, sources waiting to be onboarded and commands with an uncertain outcome. Start here.')]
#[IsReadOnly]
#[IsIdempotent]
#[IsOpenWorld(false)]
final class GetOverview extends AgentTool
{
    protected string $name = 'get_overview';

    protected ?string $permission = 'Device.view';

    public function schema(JsonSchema $schema): array
    {
        return [];
    }

    protected function run(Request $request, AgentContext $context): array
    {
        app(DeviceAuthorization::class)->authorize($context->user, DevicePermission::VIEW, $context->organization);
        $summary = app(OverviewQuery::class)->summary($context->organization);

        return ['data' => [
            'organization' => ['uuid' => $context->organization->uuid, 'name' => $context->organization->name, 'timezone' => $context->organization->timezone],
            'devices' => $summary['devices'],
            'alerts' => $summary['alerts'],
            'automations' => $summary['automations'],
            'discovery' => $summary['discovery'],
            'commands' => ['uncertain' => $summary['commands']['uncertain']],
            'portal_url' => app(PortalUrls::class)->organization($context->organization, 'home'),
        ]];
    }
}
