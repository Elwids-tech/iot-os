<?php

declare(strict_types=1);

namespace App\Domain\Agents\Mcp\Tools;

use App\Domain\Agents\Mcp\AgentContext;
use App\Domain\Agents\Mcp\AgentTool;
use App\Domain\Agents\Mcp\PortalUrls;
use App\Domain\Automation\Services\AlertQuery;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Validation\Rule;
use Laravel\Mcp\Request;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Tools\Annotations\IsIdempotent;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Description('Alert episodes, newest first: active ones by default, or cleared history. Filter by device, site or workflow. Acknowledging and assigning alerts happen in the portal (portal_url).')]
#[IsReadOnly]
#[IsIdempotent]
#[IsOpenWorld(false)]
final class ListAlerts extends AgentTool
{
    protected string $name = 'list_alerts';

    protected ?string $permission = 'Device.view';

    public function schema(JsonSchema $schema): array
    {
        return [
            'condition' => $schema->string()->enum(['active', 'cleared'])->default('active'),
            'device_uuid' => $schema->string()->format('uuid'),
            'site_uuid' => $schema->string()->format('uuid'),
            'workflow_uuid' => $schema->string()->format('uuid'),
            'cursor' => $schema->string(),
            'limit' => $schema->integer()->min(1)->max(50)->default(20),
        ];
    }

    protected function run(Request $request, AgentContext $context): array
    {
        $input = $request->validate([
            'condition' => ['nullable', Rule::in(['active', 'cleared'])],
            'device_uuid' => ['nullable', 'uuid'],
            'site_uuid' => ['nullable', 'uuid'],
            'workflow_uuid' => ['nullable', 'uuid'],
            'cursor' => ['nullable', 'string', 'max:20', 'regex:/^[1-9][0-9]*$/'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:50'],
        ]);
        app(DeviceAuthorization::class)->authorize($context->user, DevicePermission::VIEW, $context->organization);
        $alerts = app(AlertQuery::class);
        $page = (int) ($input['cursor'] ?? 1);
        $result = $alerts->filtered($context->organization, array_filter([
            'condition' => $input['condition'] ?? 'active',
            'device' => $input['device_uuid'] ?? null,
            'site' => $input['site_uuid'] ?? null,
            'workflow' => $input['workflow_uuid'] ?? null,
        ]))->orderByDesc('automation_alerts.id')->paginate((int) ($input['limit'] ?? 20), ['automation_alerts.*'], 'page', $page);
        $urls = app(PortalUrls::class);
        $rows = collect($alerts->views($context->organization, $result->getCollection()))->map(fn (array $alert): array => [
            'uuid' => $alert['uuid'],
            'kind' => $alert['kind'],
            'episode' => $alert['episode'],
            'condition' => $alert['condition'],
            'activated_at' => $alert['activated_at'],
            'cleared_at' => $alert['cleared_at'],
            'acknowledged_at' => $alert['acknowledged_at'],
            'device' => ['uuid' => $alert['device_uuid'], 'name' => $alert['device_name']],
            'workflow' => $alert['workflow_uuid'] === null ? null : ['uuid' => $alert['workflow_uuid'], 'name' => $alert['workflow_name']],
            'portal_url' => $urls->organization($context->organization, 'alerts/'.$alert['uuid']),
        ])->values()->all();

        return [
            'data' => ['alerts' => $rows],
            'page' => ['next' => $result->hasMorePages() ? (string) ($page + 1) : null, 'total' => $result->total()],
            'targets' => array_values(array_filter(array_column(array_column($rows, 'device'), 'uuid'))),
        ];
    }
}
