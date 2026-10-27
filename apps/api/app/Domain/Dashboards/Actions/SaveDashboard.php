<?php

declare(strict_types=1);

namespace App\Domain\Dashboards\Actions;

use App\Domain\Dashboards\Models\Dashboard;
use App\Domain\Dashboards\Models\DashboardRevision;
use App\Domain\Dashboards\Services\DashboardAccess;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Saves a document that DashboardDefinition::validateDocument has checked, and keeps a
 * version of every save. `$origin` records who made the version when it was not the
 * person alone: `assistant` (spec 019) or `agent` (spec 004).
 */
final class SaveDashboard
{
    /** Versions kept per dashboard; older ones are pruned on save. */
    public const KEPT_REVISIONS = 50;

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

            return $dashboard;
        });
    }

    /**
     * Saves over the dashboard when it is still at `$revision`, else 409.
     *
     * @param  array<string, mixed>  $document
     */
    public function update(Dashboard $dashboard, User $user, array $document, int $revision, ?string $origin = null): Dashboard
    {
        return DB::transaction(function () use ($dashboard, $document, $origin, $revision, $user): Dashboard {
            $locked = $this->lock($dashboard, $revision);
            $locked->update([...$document, 'revision' => $locked->revision + 1, 'updated_by' => $user->id]);
            $this->snapshot($locked, $origin);

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
