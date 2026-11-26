<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Services;

use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Entities\Models\Entity;
use App\Domain\Entities\Models\EntityType;
use App\Domain\Integrations\Models\IntegrationApplication;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

/** Builds an application's resolved grant and keeps scopes in step with the hierarchy (spec 030, spec 009). */
final class ApplicationGrants
{
    public static function for(IntegrationApplication $application): ApplicationGrant
    {
        return new ApplicationGrant(
            (int) $application->organization_id,
            array_values($application->device_uuids ?? []),
            array_values($application->entity_uuids ?? []),
        );
    }

    /**
     * An archived entity leaves every scope naming it, with the consequences of a saved
     * grant (spec 030, FR-021): revisions bump, tokens are deleted, the webhook is disabled
     * and the change is audited, with `reason: site_deleted` for a Site entity as before and
     * `entity_archived` otherwise. A scope left empty stays empty and resolves to no device
     * until a manager edits the application. Call inside the transaction that archives it.
     */
    public static function entityArchived(Entity $entity, ?int $actor = null): void
    {
        $actor ??= Auth::id();
        $isSite = EntityType::query()->whereKey($entity->entity_type_id)->value('key') === EntityType::SITE;
        $applications = IntegrationApplication::where('organization_id', $entity->organization_id)
            ->whereNotNull('entity_uuids')->lockForUpdate()->get()
            ->filter(fn (IntegrationApplication $application) => in_array($entity->uuid, $application->entity_uuids ?? [], true));
        foreach ($applications as $application) {
            $remaining = array_values(array_diff($application->entity_uuids, [$entity->uuid]));
            $application->update(['entity_uuids' => $remaining, 'revision' => $application->revision + 1, 'grant_revision' => $application->grant_revision + 1]);
            $application->tokens()->delete();
            WebhookDispatch::cancel($application->id, $isSite ? 'Application grants changed: a granted site was deleted.' : 'Application grants changed: a granted entity was archived.');
            DeviceAudit::record('application.grants_updated', $application->organization_id, $actor, $application->uuid, $isSite
                ? ['reason' => 'site_deleted', 'site_uuid' => $entity->uuid, 'site_name' => $entity->name, 'entity_uuids' => $remaining]
                : ['reason' => 'entity_archived', 'entity_uuid' => $entity->uuid, 'entity_name' => $entity->name, 'entity_uuids' => $remaining]);
        }
    }

    /**
     * Which applications gain or lose devices when an entity's branch moves under another
     * parent, for the move's confirmation (spec 009 US1 AS4). A device stays covered by a
     * scope inside the branch; otherwise it is covered before the move when a scope sits at
     * or above the old parent, and after it when one sits at or above the new parent.
     *
     * @param  Collection<int, object{id: int, entity_id: int}>  $devices  the active devices anchored in the branch
     * @return list<array{uuid: string, name: string, gains: int, loses: int}>
     */
    public static function moveChanges(Entity $entity, ?Entity $parent, Collection $devices): array
    {
        if ($devices->isEmpty() || $entity->parent_id === $parent?->id) {
            return [];
        }
        $branch = DB::table('entity_closure')->where('ancestor_id', $entity->id)->pluck('descendant_id')->map(fn ($id) => (int) $id)->all();
        $above = fn (?int $id): array => $id === null ? [] : DB::table('entity_closure')->where('descendant_id', $id)->pluck('ancestor_id')->map(fn ($a) => (int) $a)->all();
        $oldAbove = $above($entity->parent_id);
        $newAbove = $above($parent?->id);
        // Each device's ancestors inside the branch.
        $inBranch = DB::table('entity_closure')->whereIn('descendant_id', $devices->pluck('entity_id')->unique()->all())->whereIn('ancestor_id', $branch)
            ->get(['descendant_id', 'ancestor_id'])->groupBy('descendant_id')->map(fn ($rows) => $rows->pluck('ancestor_id')->map(fn ($a) => (int) $a)->all());

        $result = [];
        foreach (IntegrationApplication::where('organization_id', $entity->organization_id)->whereNull('revoked_at')->whereNotNull('entity_uuids')->orderBy('name')->get() as $application) {
            if (($application->entity_uuids ?? []) === [] || ($application->device_uuids ?? []) !== []) {
                continue;
            }
            $scoped = self::for($application)->scopedQuery()->pluck('id')->map(fn ($id) => (int) $id)->all();
            $before = array_intersect($scoped, $oldAbove) !== [];
            $after = array_intersect($scoped, $newAbove) !== [];
            if ($before === $after) {
                continue;
            }
            $moving = $devices->filter(fn ($device) => array_intersect($scoped, $inBranch[$device->entity_id] ?? []) === [])->count();
            if ($moving > 0) {
                $result[] = ['uuid' => (string) $application->uuid, 'name' => (string) $application->name, 'gains' => $after ? $moving : 0, 'loses' => $before ? $moving : 0];
            }
        }

        return $result;
    }
}
