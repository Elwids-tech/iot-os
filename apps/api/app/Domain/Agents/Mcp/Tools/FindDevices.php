<?php

declare(strict_types=1);

namespace App\Domain\Agents\Mcp\Tools;

use App\Domain\Agents\Mcp\AgentContext;
use App\Domain\Agents\Mcp\AgentTool;
use App\Domain\Agents\Mcp\PortalUrls;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Devices\Services\DeviceDirectory;
use App\Domain\Devices\Services\DeviceView;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Validation\Rule;
use Laravel\Mcp\Request;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Tools\Annotations\IsIdempotent;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Description('Find devices by name or code, site, tag, profile, lifecycle or presence. Returns one page; pass the returned cursor for the next. Presence "quiet" means online with no reading for an hour; "unknown" means the runtime has not confirmed it recently.')]
#[IsReadOnly]
#[IsIdempotent]
#[IsOpenWorld(false)]
final class FindDevices extends AgentTool
{
    protected string $name = 'find_devices';

    protected ?string $permission = 'Device.view';

    public function schema(JsonSchema $schema): array
    {
        return [
            'search' => $schema->string()->max(255)->description('Part of the device name or code.'),
            'site_uuid' => $schema->string()->format('uuid'),
            'tag' => $schema->string()->max(32),
            'profile_uuid' => $schema->string()->format('uuid'),
            'lifecycle' => $schema->string()->enum(['registered', 'active', 'deactivated', 'archived']),
            'presence' => $schema->string()->enum(DeviceDirectory::PRESENCE),
            'cursor' => $schema->string()->description('The page.next value from the previous result.'),
            'limit' => $schema->integer()->min(1)->max(50)->default(20),
        ];
    }

    protected function run(Request $request, AgentContext $context): array
    {
        app(DeviceAuthorization::class)->authorize($context->user, DevicePermission::VIEW, $context->organization);
        $input = $request->validate([
            'search' => ['nullable', 'string', 'max:255'],
            'site_uuid' => ['nullable', 'uuid'],
            'tag' => ['nullable', 'string', 'max:32'],
            'profile_uuid' => ['nullable', 'uuid'],
            'lifecycle' => ['nullable', Rule::in(['registered', 'active', 'deactivated', 'archived'])],
            'presence' => ['nullable', Rule::in(DeviceDirectory::PRESENCE)],
            'cursor' => ['nullable', 'string', 'max:20', 'regex:/^[1-9][0-9]*$/'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:50'],
        ]);
        $page = (int) ($input['cursor'] ?? 1);
        $limit = (int) ($input['limit'] ?? 20);
        $result = app(DeviceDirectory::class)->query($context->organization, $input)->orderBy('name')->orderBy('id')
            ->paginate($limit, ['*'], 'page', $page);
        $urls = app(PortalUrls::class);
        $devices = $result->getCollection()->map(function (Device $device) use ($urls, $context): array {
            $view = DeviceView::device($device);

            return [
                'uuid' => $view['uuid'],
                'code' => $view['code'],
                'name' => $view['name'],
                'lifecycle' => $view['lifecycle'],
                'presence' => $view['presence'],
                'last_seen_at' => $device->last_seen_at?->toIso8601String(),
                'deployment_status' => $view['deployment_status'],
                'profile' => $view['profile'],
                'site' => $view['site'] ? ['uuid' => $view['site']['uuid'], 'name' => $view['site']['name']] : null,
                'tags' => $view['tags'],
                'portal_url' => $urls->organization($context->organization, 'devices/'.$device->uuid),
            ];
        })->values()->all();

        return [
            'data' => ['devices' => $devices],
            'page' => ['next' => $result->hasMorePages() ? (string) ($page + 1) : null, 'total' => $result->total()],
            'targets' => array_column($devices, 'uuid'),
        ];
    }
}
