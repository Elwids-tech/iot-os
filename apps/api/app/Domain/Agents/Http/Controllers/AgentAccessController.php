<?php

declare(strict_types=1);

namespace App\Domain\Agents\Http\Controllers;

use App\Domain\Agents\Services\AgentAccess;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;

final class AgentAccessController
{
    public function __construct(private readonly AgentAccess $access) {}

    /**
     * The organization's agent access setting and the address agents connect to.
     *
     * @return array{data: array{enabled: bool, can_manage: bool, connector_url: string}}
     */
    public function show(Request $request, Organization $organization): array
    {
        return ['data' => $this->settings($request, $organization)];
    }

    /**
     * Switch agent access on or off for the organization. Switching it off stops every connection at its next call.
     *
     * @return array{data: array{enabled: bool, can_manage: bool, connector_url: string}}
     */
    public function update(Request $request, Organization $organization): array
    {
        abort_unless($this->access->canManage($request->user(), $organization), 403);
        $input = $request->validate(['enabled' => ['required', 'boolean']]);
        $this->access->setEnabled($request->user(), $organization, (bool) $input['enabled']);

        return ['data' => $this->settings($request, $organization->refresh())];
    }

    /** @return array{enabled: bool, can_manage: bool, connector_url: string} */
    private function settings(Request $request, Organization $organization): array
    {
        return [
            'enabled' => (bool) $organization->agent_access_enabled,
            'can_manage' => $this->access->canManage($request->user(), $organization),
            'connector_url' => $this->access->connectorUrl(),
        ];
    }
}
