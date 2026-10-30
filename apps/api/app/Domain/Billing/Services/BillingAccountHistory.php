<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\BillingAccountAssignment;
use App\Domain\Shared\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * A billing account's latest history (spec 023 FR-020, FR-021, research R11): its
 * audit events plus organizations joining and leaving it, newest first. Deletion is
 * audited too, but a deleted account is never shown, so it is not listed here.
 */
final class BillingAccountHistory
{
    private const LIMIT = 100;

    private const RANK = [
        'created' => 0,
        'updated' => 1,
        'owner_added' => 1,
        'owner_removed' => 1,
        'organization_left' => 2,
        'organization_joined' => 3,
    ];

    private const ACTIONS = [
        'billing_account.created' => 'created',
        'billing_account.updated' => 'updated',
        'billing_account.owner_added' => 'owner_added',
        'billing_account.owner_removed' => 'owner_removed',
    ];

    /**
     * @return list<BillingAccountHistoryEntry>
     */
    public function for(BillingAccount $account): array
    {
        $rows = $this->auditEvents($account)
            ->concat($this->joins($account))
            ->concat($this->departures($account))
            // Timestamps keep whole seconds, so steps of one request tie; the rank keeps
            // their order (an account is created before an organization joins it).
            ->sortByDesc(fn (array $row): string => $row['at']->utc()->format('Y-m-d H:i:s.u').self::RANK[$row['action']])
            ->take(self::LIMIT)
            ->values();

        $actors = User::query()
            ->whereIn('id', $rows->pluck('actor_id')->filter()->unique()->values())
            ->get(['id', 'name'])
            ->keyBy('id');

        return $rows
            ->map(function (array $row) use ($actors): BillingAccountHistoryEntry {
                $actor = $row['actor_id'] === null ? null : $actors->get($row['actor_id']);
                $details = $row['details'];

                return new BillingAccountHistoryEntry(
                    $row['at'],
                    $row['action'],
                    $actor === null ? null : ['id' => (int) $actor->id, 'name' => (string) $actor->name],
                    $details['organization'] ?? null,
                    $details['user'] ?? null,
                    $details['changes'] ?? [],
                );
            })
            ->all();
    }

    /**
     * @return Collection<int, array{at: CarbonImmutable, action: string, actor_id: ?int, details: array<string, mixed>}>
     */
    private function auditEvents(BillingAccount $account): Collection
    {
        return DB::table('device_audit_events')
            ->where('resource_uuid', $account->uuid)
            ->whereIn('action', array_keys(self::ACTIONS))
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->limit(self::LIMIT)
            ->get(['action', 'actor_id', 'details', 'created_at'])
            ->map(function (object $event): array {
                $details = json_decode((string) $event->details, true) ?: [];

                return [
                    'at' => CarbonImmutable::parse($event->created_at),
                    'action' => self::ACTIONS[$event->action],
                    'actor_id' => $event->actor_id === null ? null : (int) $event->actor_id,
                    'details' => match ($event->action) {
                        'billing_account.owner_added', 'billing_account.owner_removed' => [
                            'user' => ['id' => (int) ($details['user_id'] ?? 0), 'name' => (string) ($details['user_name'] ?? '')],
                        ],
                        'billing_account.updated' => ['changes' => $this->changes($details['changes'] ?? [])],
                        default => [],
                    },
                ];
            });
    }

    /**
     * @return Collection<int, array{at: CarbonImmutable, action: string, actor_id: ?int, details: array<string, mixed>}>
     */
    private function joins(BillingAccount $account): Collection
    {
        return $account->assignments()
            ->orderByDesc('started_at')
            ->limit(self::LIMIT)
            ->get()
            ->map(fn (BillingAccountAssignment $assignment): array => [
                'at' => $assignment->started_at,
                'action' => 'organization_joined',
                'actor_id' => $assignment->assigned_by,
                'details' => ['organization' => $this->organization($assignment)],
            ]);
    }

    /**
     * @return Collection<int, array{at: CarbonImmutable, action: string, actor_id: ?int, details: array<string, mixed>}>
     */
    private function departures(BillingAccount $account): Collection
    {
        return $account->assignments()
            ->whereNotNull('ended_at')
            ->orderByDesc('ended_at')
            ->limit(self::LIMIT)
            ->get()
            ->map(fn (BillingAccountAssignment $assignment): array => [
                'at' => $assignment->ended_at,
                'action' => 'organization_left',
                'actor_id' => $assignment->ended_by,
                'details' => ['organization' => $this->organization($assignment)],
            ]);
    }

    /**
     * @param  array<string, array{from?: mixed, to?: mixed}>  $changes
     * @return list<BillingAccountChange>
     */
    private function changes(array $changes): array
    {
        $list = [];

        foreach ($changes as $field => $change) {
            $list[] = new BillingAccountChange((string) $field, BillingAccountChange::text($change['from'] ?? null), BillingAccountChange::text($change['to'] ?? null));
        }

        return $list;
    }

    /**
     * @return array{uuid: string, name: string}
     */
    private function organization(BillingAccountAssignment $assignment): array
    {
        return ['uuid' => (string) $assignment->organization_uuid, 'name' => (string) $assignment->organization_name];
    }
}
