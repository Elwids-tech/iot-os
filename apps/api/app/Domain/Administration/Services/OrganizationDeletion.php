<?php

declare(strict_types=1);

namespace App\Domain\Administration\Services;

use App\Domain\Administration\Exceptions\OrganizationNotEmptyException;
use App\Domain\Agents\Enums\RevocationReason;
use App\Domain\Agents\Models\AgentConnection;
use App\Domain\Assistant\Models\AssistantConversation;
use App\Domain\Assistant\Services\AssistantRecovery;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Spatie\Permission\PermissionRegistrar;

/**
 * Permanently deletes an organization that holds nothing worth keeping and nothing that
 * needs teardown outside this database (spec 006). Everything else blocks it.
 */
final class OrganizationDeletion
{
    /**
     * Tables whose rows block deletion, with what the admin app calls them. Broker logins,
     * adapter containers and runtime history have no teardown yet, and the rest is work
     * people made. Every foreign key to organizations that does not cascade must be listed
     * here or in REMOVED_FIRST (OrganizationDeletionInventoryTest).
     */
    public const BLOCKERS = [
        'devices' => 'Devices',
        'sparkplug_connections' => 'Broker connections',
        'sparkplug_gateways' => 'Gateways',
        'device_discovery_candidates' => 'Discovered devices',
        'device_adapter_tenants' => 'Adapter runtimes',
        'device_adapters' => 'Device adapters',
        // Soft-deleted ones too: the key sets null, which would turn them into platform templates.
        'device_profiles' => 'Device profiles',
        'automation_workflows' => 'Automations',
        'automation_alerts' => 'Automation alerts',
        'automation_actions' => 'Automation actions',
        'integration_applications' => 'Integration applications',
        'integration_streams' => 'Integration event streams',
        'integration_events' => 'Integration events',
        'geofences' => 'Geofences',
        'geofence_assignments' => 'Geofence assignments',
        'geofence_activation_batches' => 'Geofence activations',
        'geofence_events' => 'Geofence events',
        'device_location_bindings' => 'Device locations',
    ];

    /** Data that goes with the organization behind restrictive keys, deleted before it. */
    public const REMOVED_FIRST = ['device_audit_events', 'telemetry_retention_settings'];

    public function __construct(private readonly AssistantRecovery $assistantRecovery) {}

    /**
     * @return list<array{key: string, label: string, count: int}>
     */
    public function blockers(Organization $organization): array
    {
        $id = $organization->getKey();
        $counts = [];

        foreach (self::BLOCKERS as $table => $label) {
            $counts[] = ['key' => $table, 'label' => $label, 'count' => DB::table($table)->where('organization_id', $id)->count()];
        }

        $counts[] = ['key' => 'assistant_runs', 'label' => 'Assistant replies in progress', 'count' => $this->reservedAssistantRuns($organization)];

        return $this->nonZero($counts);
    }

    /**
     * What deletion removes, for the confirmation. Retention settings, the permission
     * ceiling, automation settings and notification events go too but are not listed.
     *
     * @return list<array{key: string, label: string, count: int}>
     */
    public function removes(Organization $organization): array
    {
        $id = $organization->getKey();

        return $this->nonZero([
            ['key' => 'members', 'label' => 'Members (their accounts stay)', 'count' => DB::table('organization_user')->where('organization_id', $id)->count()],
            ['key' => 'roles', 'label' => 'Roles', 'count' => DB::table('roles')->where('organization_id', $id)->count()],
            ['key' => 'invitations', 'label' => 'Open invitations', 'count' => DB::table('organization_invitations')->where('organization_id', $id)->whereNull('accepted_at')->whereNull('revoked_at')->count()],
            ['key' => 'dashboards', 'label' => 'Dashboards', 'count' => DB::table('dashboards')->where('organization_id', $id)->count()],
            ['key' => 'sites', 'label' => 'Sites', 'count' => DB::table('sites')->where('organization_id', $id)->count()],
            ['key' => 'agent_connections', 'label' => 'AI agent connections', 'count' => DB::table('agent_connections')->where('organization_id', $id)->whereNull('revoked_at')->count()],
            ['key' => 'assistant_conversations', 'label' => 'Assistant conversations', 'count' => DB::table('assistant_conversations')->where('organization_id', $id)->count()],
            ['key' => 'audit_events', 'label' => 'Audit events', 'count' => DB::table('device_audit_events')->where('organization_id', $id)->count()],
        ]);
    }

    /**
     * @throws OrganizationNotEmptyException when a blocker exists by the time the row is locked
     */
    public function delete(Organization $organization, User $actor): void
    {
        $conversations = DB::transaction(function () use ($organization, $actor): array {
            $locked = Organization::query()->whereKey($organization->getKey())->lockForUpdate()->firstOrFail();
            $blockers = $this->blockers($locked);

            if ($blockers !== []) {
                throw new OrganizationNotEmptyException($blockers);
            }

            $id = $locked->getKey();

            // At most one active connection per person and client, so these tokens are this organization's.
            AgentConnection::query()->where('organization_id', $id)->active()->get()
                ->each(fn (AgentConnection $connection) => $connection->revoke(RevocationReason::ADMINISTRATOR, $actor));

            $conversations = AssistantConversation::query()->where('organization_id', $id)->get(['id', 'sdk_conversation_id']);
            $sdkConversations = $conversations->pluck('sdk_conversation_id')->filter()->values()->all();

            if ($sdkConversations !== []) {
                DB::table('agent_conversation_messages')->whereIn('conversation_id', $sdkConversations)->delete();
                DB::table('agent_conversations')->whereIn('id', $sdkConversations)->delete();
            }

            foreach (self::REMOVED_FIRST as $table) {
                DB::table($table)->where('organization_id', $id)->delete();
            }

            // Members, roles, invitations, dashboards, sites, settings and agent connections cascade.
            $locked->forceDelete();

            DeviceAudit::record('organization.deleted', null, $actor->getKey(), $locked->uuid, [
                'name' => $locked->name,
                'slug' => $locked->slug,
            ]);

            return $conversations->pluck('id')->all();
        });

        foreach ($conversations as $conversation) {
            Storage::disk('local')->deleteDirectory('assistant/'.$conversation);
        }

        // Role rows went by cascade, which the permission cache never hears about.
        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }

    private function reservedAssistantRuns(Organization $organization): int
    {
        $runs = fn () => DB::table('assistant_runs')
            ->join('assistant_conversations', 'assistant_conversations.id', '=', 'assistant_runs.conversation_id')
            ->where('assistant_conversations.organization_id', $organization->getKey())
            ->where('assistant_runs.reserved_usd', '>', 0);

        if (! $runs()->exists()) {
            return 0;
        }

        // Releases reservations whose worker died; live runs keep theirs.
        AssistantConversation::query()->where('organization_id', $organization->getKey())->get()
            ->each(fn (AssistantConversation $conversation) => $this->assistantRecovery->recover($conversation));

        return $runs()->count();
    }

    /**
     * @param  list<array{key: string, label: string, count: int}>  $counts
     * @return list<array{key: string, label: string, count: int}>
     */
    private function nonZero(array $counts): array
    {
        return array_values(array_filter($counts, fn (array $entry): bool => $entry['count'] > 0));
    }
}
