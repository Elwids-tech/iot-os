<?php

declare(strict_types=1);

namespace App\Domain\Audit\Services;

use App\Domain\Audit\Models\Activity;
use App\Domain\Authorization\Models\Role;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Contracts\Pagination\CursorPaginator;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * What people did, newest first, for platform administrators (spec 024 US1, US2).
 * System events (no actor) are left out. One page is 50 events; the cursor is on id,
 * which follows recording order.
 */
final class ActivityFeed
{
    public const PER_PAGE = 50;

    /** Where a kind's current name is, by subject UUID. */
    private const NAMED_BY_UUID = [
        'device' => ['devices', 'name'],
        'site' => ['sites', 'name'],
        'dashboard' => ['dashboards', 'name'],
        'device_profile' => ['device_profiles', 'name'],
        'device_adapter' => ['device_adapters', 'name'],
        'application' => ['integration_applications', 'name'],
        'workflow' => ['automation_workflows', 'name'],
        'geofence' => ['geofences', 'name'],
        'billing_account' => ['billing_accounts', 'name'],
        'organization' => ['organizations', 'name'],
    ];

    /** Kinds without a UUID, named by the subject's model. */
    private const NAMED_BY_MODEL = [
        'user' => [User::class, 'users', 'name'],
        'role' => [Role::class, 'roles', 'display_name'],
    ];

    /**
     * @return CursorPaginator<int, ActivityEntry>
     */
    public function page(?int $userId, ?Organization $organization): CursorPaginator
    {
        $page = Activity::query()
            ->whereNotNull('causer_id')
            ->when($userId !== null, fn ($query) => $query->where('causer_type', (new User)->getMorphClass())->where('causer_id', $userId))
            ->when($organization !== null, fn ($query) => $query->where('organization_id', $organization->getKey()))
            ->orderByDesc('id')
            ->cursorPaginate(self::PER_PAGE)
            ->withQueryString();

        /** @var Collection<int, Activity> $activities */
        $activities = collect($page->items());
        $actors = User::query()->whereIn('id', $activities->pluck('causer_id')->unique()->values())->get(['id', 'name', 'email'])->keyBy('id');
        $organizations = Organization::withTrashed()->whereIn('id', $activities->pluck('organization_id')->filter()->unique()->values())->get(['id', 'uuid', 'name'])->keyBy('id');
        $names = $this->subjectNames($activities);

        return $page->through(function (Activity $activity) use ($actors, $organizations, $names): ActivityEntry {
            $action = (string) ($activity->event ?? $activity->description);
            $details = $activity->properties?->toArray() ?? [];
            $actor = $actors->get($activity->causer_id);
            $organization = $activity->organization_id === null ? null : $organizations->get($activity->organization_id);
            $kind = ActivityCatalogue::kind($action);
            $name = $names[$this->subjectKey($activity, $kind)] ?? $activity->subject_name;

            return new ActivityEntry(
                id: (int) $activity->id,
                action: $action,
                summary: ActivityCatalogue::summary($action, $details),
                at: $activity->created_at->toImmutable(),
                actorId: (int) $activity->causer_id,
                actorName: $actor?->name,
                actorEmail: $actor?->email,
                organizationUuid: $organization?->uuid,
                organizationName: $organization?->name,
                subjectType: $kind,
                subjectUuid: $activity->subject_uuid,
                subjectName: $name,
                changes: $this->changes($activity, $details),
                details: $this->details($details, $name),
            );
        });
    }

    /**
     * Current names of the page's subjects, keyed by {@see subjectKey()}; one query per kind.
     *
     * @param  Collection<int, Activity>  $activities
     * @return array<string, string>
     */
    private function subjectNames(Collection $activities): array
    {
        $names = [];
        $byKind = $activities->groupBy(fn (Activity $activity): string => (string) ActivityCatalogue::kind((string) $activity->event));

        foreach (self::NAMED_BY_UUID as $kind => [$table, $column]) {
            $uuids = $byKind->get($kind, collect())->pluck('subject_uuid')->filter()->unique()->values();
            if ($uuids->isNotEmpty()) {
                foreach (DB::table($table)->whereIn('uuid', $uuids)->pluck($column, 'uuid') as $uuid => $name) {
                    $names[$kind.':'.$uuid] = (string) $name;
                }
            }
        }

        foreach (self::NAMED_BY_MODEL as $kind => [$model, $table, $column]) {
            $ids = $byKind->get($kind, collect())
                ->filter(fn (Activity $activity): bool => $activity->subject_type === (new $model)->getMorphClass())
                ->pluck('subject_id')->unique()->values();
            if ($ids->isNotEmpty()) {
                foreach (DB::table($table)->whereIn('id', $ids)->pluck($column, 'id') as $id => $name) {
                    $names[$kind.':#'.$id] = (string) $name;
                }
            }
        }

        return $names;
    }

    private function subjectKey(Activity $activity, ?string $kind): string
    {
        return isset(self::NAMED_BY_MODEL[$kind]) ? $kind.':#'.$activity->subject_id : $kind.':'.$activity->subject_uuid;
    }

    /**
     * Field changes, then fields only named as changed (`details.changed`).
     *
     * @param  array<string, mixed>  $details
     * @return list<ActivityChange>
     */
    private function changes(Activity $activity, array $details): array
    {
        $recorded = $activity->attribute_changes?->toArray() ?? [];
        $changes = [];

        foreach ($recorded['attributes'] ?? [] as $field => $to) {
            $changes[] = new ActivityChange((string) $field, self::text($recorded['old'][$field] ?? null), self::text($to));
        }

        foreach (is_array($details['changed'] ?? null) ? $details['changed'] : [] as $field) {
            $changes[] = new ActivityChange((string) $field, null, null, opaque: true);
        }

        return $changes;
    }

    /**
     * The details as text, without identifiers people cannot read, the fields already
     * listed as changed, or a repeat of the subject's name.
     *
     * @param  array<string, mixed>  $details
     * @return array<string, string>
     */
    private function details(array $details, ?string $subjectName): array
    {
        $text = [];
        foreach ($details as $key => $value) {
            $key = (string) $key;
            if ($key === 'changed' || $value === null || preg_match('/(^|_)(uuid|hash|id)$/', $key) === 1) {
                continue;
            }
            $value = self::text($value);
            $value = is_array($value) ? implode(', ', $value) : (string) $value;
            if ($value !== $subjectName) {
                $text[$key] = $value;
            }
        }

        return $text;
    }

    /**
     * Scalars as text and lists of scalars as lists; anything else as cut JSON.
     *
     * @return string|list<string>|null
     */
    private static function text(mixed $value): string|array|null
    {
        return match (true) {
            $value === null => null,
            is_bool($value) => $value ? 'Yes' : 'No',
            is_scalar($value) => mb_strimwidth((string) $value, 0, 200, '…'),
            is_array($value) && array_is_list($value) && array_filter($value, fn (mixed $item): bool => ! is_scalar($item)) === [] => array_map(fn (mixed $item): string => (string) $item, $value),
            default => mb_strimwidth((string) json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), 0, 200, '…'),
        };
    }
}
