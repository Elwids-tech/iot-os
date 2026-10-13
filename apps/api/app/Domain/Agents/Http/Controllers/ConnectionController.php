<?php

declare(strict_types=1);

namespace App\Domain\Agents\Http\Controllers;

use App\Domain\Agents\Enums\RevocationReason;
use App\Domain\Agents\Models\AgentActivity;
use App\Domain\Agents\Models\AgentConnection;
use App\Domain\Agents\Services\AgentAccess;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/** Connected AI apps: a person's own connections, and an administrator's view of an organization's. */
final class ConnectionController
{
    public function __construct(private readonly AgentAccess $access) {}

    /**
     * The signed-in person's agent connections in every organization.
     *
     * @return array{data: list<array<string, mixed>>}
     */
    public function mine(Request $request): array
    {
        return ['data' => AgentConnection::query()->where('user_id', $request->user()->id)
            ->with(['organization', 'client'])->latest('id')->limit(100)->get()
            ->map(fn (AgentConnection $connection): array => $this->present($connection))->values()->all()];
    }

    /** Disconnect one of your own agents; it stops at its next request. */
    public function disconnectMine(Request $request, string $connection): Response
    {
        $found = AgentConnection::query()->where('uuid', $connection)->where('user_id', $request->user()->id)->firstOrFail();
        $found->revoke(RevocationReason::PERSON, $request->user());

        return response()->noContent();
    }

    /**
     * Every member's agent connections to the organization (administrators).
     *
     * @return array{data: list<array<string, mixed>>}
     */
    public function index(Request $request, Organization $organization): array
    {
        abort_unless($this->access->canManage($request->user(), $organization), 403);

        return ['data' => AgentConnection::query()->where('organization_id', $organization->id)
            ->with(['organization', 'client', 'user'])->latest('id')->limit(200)->get()
            ->map(fn (AgentConnection $connection): array => [...$this->present($connection), 'user' => ['id' => $connection->user->id, 'name' => $connection->user->name, 'email' => $connection->user->email]])
            ->values()->all()];
    }

    /** Disconnect a member's agent (administrators); it stops at its next request. */
    public function disconnect(Request $request, Organization $organization, string $connection): Response
    {
        abort_unless($this->access->canManage($request->user(), $organization), 403);
        $found = AgentConnection::query()->where('uuid', $connection)->where('organization_id', $organization->id)->firstOrFail();
        if ($found->revoked_at === null) {
            $found->revoke(RevocationReason::ADMINISTRATOR, $request->user());
            DeviceAudit::record('agents.connection_revoked', $organization->id, $request->user()->id, $found->uuid, ['user_id' => $found->user_id]);
        }

        return response()->noContent();
    }

    /**
     * What a connection did, newest first (its owner, or an administrator).
     *
     * @return array{data: list<array{tool: string, outcome: string, reason: string|null, targets: list<string>, duration_ms: int, created_at: string}>, meta: array{current_page: int, last_page: int, total: int}}
     */
    public function activity(Request $request, Organization $organization, string $connection): array
    {
        $found = AgentConnection::query()->where('uuid', $connection)->where('organization_id', $organization->id)->firstOrFail();
        abort_unless($found->user_id === $request->user()->id || $this->access->canManage($request->user(), $organization), 404);
        $page = AgentActivity::query()->where('agent_connection_id', $found->id)->latest('id')->paginate(50);

        return [
            'data' => $page->getCollection()->map(fn (AgentActivity $activity): array => [
                'tool' => $activity->tool,
                'outcome' => $activity->outcome->value,
                'reason' => $activity->reason,
                'targets' => $activity->targets ?? [],
                'duration_ms' => $activity->duration_ms,
                'created_at' => $activity->created_at->toIso8601String(),
            ])->values()->all(),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()],
        ];
    }

    /** @return array<string, mixed> */
    private function present(AgentConnection $connection): array
    {
        $client = $connection->client;
        $redirects = $client?->redirect_uris ?? [];

        return [
            'uuid' => $connection->uuid,
            'agent' => ['name' => $connection->clientName(), 'redirect_host' => (string) parse_url((string) ($redirects[0] ?? ''), PHP_URL_HOST)],
            'organization' => ['uuid' => $connection->organization->uuid, 'name' => $connection->organization->name],
            'access_level' => $connection->access_level->value,
            'created_at' => $connection->created_at->toIso8601String(),
            'last_used_at' => $connection->last_used_at?->toIso8601String(),
            'expires_at' => $connection->expires_at->toIso8601String(),
            'state' => $this->state($connection),
            'revoked_reason' => $connection->revoked_reason?->value,
        ];
    }

    private function state(AgentConnection $connection): string
    {
        return match (true) {
            $connection->revoked_at !== null => 'revoked',
            $connection->isExpired() => 'expired',
            ! $this->access->organizationEnabled($connection->organization) => 'unavailable',
            default => 'active',
        };
    }
}
