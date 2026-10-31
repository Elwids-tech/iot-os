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
     * What blocks deletion, grouped the way people act on it. Broker logins, adapter
     * containers and runtime history have no teardown yet, and the rest is work people
     * made. A group shows the count of its first table with rows; the later tables only
     * hold rows that hang off the first. Every foreign key to organizations that does not
     * cascade must be in a group or in REMOVED_FIRST (OrganizationDeletionInventoryTest).
     *
     * @var array<string, array{label: string, tables: list<string>}>
     */
    public const BLOCKERS = [
        'devices' => ['label' => 'Devices', 'tables' => ['devices', 'device_location_bindings']],
        'broker_connections' => ['label' => 'Broker connections', 'tables' => ['sparkplug_connections']],
        'gateways' => ['label' => 'Gateways', 'tables' => ['sparkplug_gateways', 'device_discovery_candidates']],
        'device_adapters' => ['label' => 'Device adapters', 'tables' => ['device_adapters']],
        'adapter_runtimes' => ['label' => 'Adapter runtimes', 'tables' => ['device_adapter_tenants']],
        // Soft-deleted ones too: the key sets null, which would turn them into platform templates.
        'device_profiles' => ['label' => 'Device profiles', 'tables' => ['device_profiles']],
        // An alert's comments, deliveries and listed devices (automation_alert_devices,
        // spec 018) have no organization of their own: they go only with their alert.
        'automations' => ['label' => 'Automations', 'tables' => ['automation_workflows', 'automation_alerts', 'automation_actions']],
        'integrations' => ['label' => 'Integration applications', 'tables' => ['integration_applications', 'integration_streams', 'integration_events']],
        'geofences' => ['label' => 'Geofences', 'tables' => ['geofences', 'geofence_assignments', 'geofence_activation_batches', 'geofence_events']],
    ];

    /** Data that goes with the organization behind restrictive keys, deleted before it. */
    public const REMOVED_FIRST = ['device_audit_events', 'telemetry_retention_settings'];

    /**
     * Records the platform team keeps after the organization is gone: their key sets
     * null. Support tickets (spec 015) lose their tagged participants here. Billing
     * assignments (spec 023) keep which account paid for the organization, and when.
     */
    public const KEPT = ['billing_account_assignments', 'support_tickets'];

    public function __construct(private readonly AssistantRecovery $assistantRecovery) {}

    /**
     * @return list<array{key: string, label: string, count: int}>
     */
    public function blockers(Organization $organization): array
    {
        $id = $organization->getKey();
        $counts = [];

        foreach (self::BLOCKERS as $key => $blocker) {
            $count = 0;

            foreach ($blocker['tables'] as $table) {
                if (($count = DB::table($table)->where('organization_id', $id)->count()) > 0) {
                    break;
                }
            }

            $counts[] = ['key' => $key, 'label' => $blocker['label'], 'count' => $count];
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

            // Bell notifications (spec 022) name their organization inside `data`, so no
            // key cascades them. Alerts block deletion; this clears what is left.
            DB::table('notifications')->where('type', 'alert')->where('data->organization_uuid', $locked->uuid)->delete();

            // Support tickets stay with the team (organization_id becomes null); the
            // colleagues tagged on them lose access with the organization (spec 015).
            DB::table('support_ticket_participants')
                ->whereIn('ticket_id', DB::table('support_tickets')->where('organization_id', $id)->select('id'))
                ->delete();

            // The billing account keeps the organization's history, closed as of now.
            DB::table('billing_account_assignments')
                ->where('organization_id', $id)
                ->whereNull('ended_at')
                ->update(['ended_at' => now(), 'ended_by' => $actor->getKey()]);

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

    /**
     * @return list<string>
     */
    public static function blockingTables(): array
    {
        return array_merge(...array_values(array_map(fn (array $blocker): array => $blocker['tables'], self::BLOCKERS)));
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
