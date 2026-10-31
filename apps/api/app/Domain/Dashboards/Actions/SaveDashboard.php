<?php

declare(strict_types=1);

namespace App\Domain\Dashboards\Actions;

use App\Domain\Audit\Services\ActivityChanges;
use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Dashboards\Models\Dashboard;
use App\Domain\Dashboards\Models\DashboardRevision;
use App\Domain\Dashboards\Services\DashboardAccess;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Saves a document that DashboardDefinition::validateDocument has checked, and keeps a
 * version of every save. `$origin` records who made the version when it was not the
 * person alone: `assistant` (spec 019) or `agent` (spec 004). Each save is in the
 * activity log (spec 024): names, folders and tags as changes, the rest as changed.
 */
final class SaveDashboard
{
    /** Versions kept per dashboard; older ones are pruned on save. */
    public const KEPT_REVISIONS = 50;

    /** Fields recorded with their values; the others are only named as changed. */
    private const DIFFED = ['name', 'folder', 'tags'];

    private const OPAQUE = ['widgets', 'layouts', 'defaults'];

    /**
     * A new dashboard the person owns, open to the organization.
     *
     * @param  array<string, mixed>  $document
     */
    public function create(Organization $organization, User $user, array $document, ?string $origin = null): Dashboard
    {
        return DB::transaction(function () use ($document, $organization, $origin, $user): Dashboard {
            $dashboard = Dashboard::create(['tags' => [], 'folder' => null, ...$document, 'revision' => 1, 'access' => DashboardAccess::ORGANIZATION, 'organization_id' => $organization->id, 'created_by' => $user->id, 'updated_by' => $user->id]);
            $this->snapshot($dashboard, $origin);
            ActivityLog::record('dashboard.created', $organization, $user, $dashboard, array_filter(['origin' => $origin]));

            return $dashboard;
        });
    }

    /**
     * Saves over the dashboard when it is still at `$revision`, else 409.
     *
     * @param  array<string, mixed>  $document
     */
    public function update(Dashboard $dashboard, User $user, array $document, int $revision, ?string $origin = null, string $action = 'dashboard.updated', array $details = []): Dashboard
    {
        return DB::transaction(function () use ($dashboard, $document, $origin, $revision, $user, $action, $details): Dashboard {
            $locked = $this->lock($dashboard, $revision);
            $before = $locked->only([...self::DIFFED, ...self::OPAQUE]);
            $locked->update([...$document, 'revision' => $locked->revision + 1, 'updated_by' => $user->id]);
            $this->snapshot($locked, $origin);

            $after = $locked->only([...self::DIFFED, ...self::OPAQUE]);
            $changed = array_values(array_filter(self::OPAQUE, fn (string $field): bool => $before[$field] != $after[$field]));
            ActivityLog::record($action, $locked->organization_id, $user, $locked, array_filter([
                ...$details,
                'revision' => $locked->revision,
                'origin' => $origin,
                'changed' => $changed,
            ], fn (mixed $value): bool => $value !== null && $value !== []), ActivityChanges::between($before, $after, self::DIFFED));

            return $locked;
        });
    }

    /** Locks the dashboard for the caller's transaction; 409 when another session saved since `$revision`. */
    public function lock(Dashboard $dashboard, int $revision): Dashboard
    {
        $locked = Dashboard::whereKey($dashboard->id)->lockForUpdate()->firstOrFail();
        abort_unless($locked->revision === $revision, 409, 'This dashboard changed in another session. Your draft is preserved. Reload the latest version before editing again.');

        return $locked;
    }

    public function snapshot(Dashboard $dashboard, ?string $origin = null): void
    {
        DashboardRevision::create([...$dashboard->only(['revision', 'name', 'widgets', 'layouts', 'defaults', 'tags', 'folder']), 'dashboard_id' => $dashboard->id, 'created_by' => $dashboard->updated_by, 'origin' => $origin]);
        $oldestKept = DashboardRevision::where('dashboard_id', $dashboard->id)->orderByDesc('revision')->skip(self::KEPT_REVISIONS - 1)->value('revision');
        DashboardRevision::where('dashboard_id', $dashboard->id)->where('revision', '<', $oldestKept ?? 0)->delete();
    }
}
