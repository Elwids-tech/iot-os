<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Services;

use App\Domain\Devices\Models\Site;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Entities\Models\Entity;
use App\Domain\Entities\Models\EntityType;
use App\Domain\Integrations\Models\IntegrationApplication;
use Illuminate\Support\Facades\Auth;

/** Builds an application's resolved grant and keeps scopes in step with site deletions (spec 030). */
final class ApplicationGrants
{
    public static function for(IntegrationApplication $application): ApplicationGrant
    {
        return new ApplicationGrant(
            (int) $application->organization_id,
            array_values($application->device_uuids ?? []),
            array_values($application->site_uuids ?? []),
        );
    }

    /**
     * A deleted site leaves every scope naming it, with the consequences of a saved grant
     * (FR-021): revisions bump, tokens are deleted, the webhook is disabled and the
     * change is audited with `reason: site_deleted`. A scope left empty stays empty and
     * resolves to no device until a manager edits the application. Call inside the
     * transaction that deletes the site.
     */
    /**
     * An archived entity leaves every scope that names it, as a deleted site always did
     * (spec 009). Only Site entities can be in a scope until applications follow any
     * entity (spec 009 PR 8).
     */
    public static function entityArchived(Entity $entity, ?int $actor = null): void
    {
        $site = Site::withoutGlobalScopes()->find($entity->id);
        if ($site && Entity::query()->whereKey($entity->id)->whereHas('type', fn ($q) => $q->where('key', EntityType::SITE))->exists()) {
            self::siteDeleted($site, $actor);
        }
    }

    /**
     * Which applications gain or lose devices when devices change site, for a move's
     * confirmation (spec 009 US1 AS4). Each change is `[old site id, new site id]`.
     *
     * @param  list<array{0: ?int, 1: ?int}>  $changes
     * @return list<array{uuid: string, name: string, gains: int, loses: int}>
     */
    public static function siteChanges(int $organizationId, array $changes): array
    {
        if ($changes === []) {
            return [];
        }
        $result = [];
        foreach (IntegrationApplication::where('organization_id', $organizationId)->whereNotNull('site_uuids')->orderBy('name')->get() as $application) {
            if (($application->site_uuids ?? []) === [] || ($application->device_uuids ?? []) !== []) {
                continue;
            }
            $grant = self::for($application);
            $gains = $loses = 0;
            foreach ($changes as [$old, $new]) {
                $before = $old !== null && $grant->coversSite($old);
                $after = $new !== null && $grant->coversSite($new);
                $gains += (int) (! $before && $after);
                $loses += (int) ($before && ! $after);
            }
            if ($gains + $loses > 0) {
                $result[] = ['uuid' => (string) $application->uuid, 'name' => (string) $application->name, 'gains' => $gains, 'loses' => $loses];
            }
        }

        return $result;
    }

    public static function siteDeleted(Site $site, ?int $actor = null): void
    {
        $actor ??= Auth::id();
        $applications = IntegrationApplication::where('organization_id', $site->organization_id)
            ->whereNotNull('site_uuids')->lockForUpdate()->get()
            ->filter(fn (IntegrationApplication $application) => in_array($site->uuid, $application->site_uuids ?? [], true));
        foreach ($applications as $application) {
            $remaining = array_values(array_diff($application->site_uuids, [$site->uuid]));
            $application->update(['site_uuids' => $remaining, 'revision' => $application->revision + 1, 'grant_revision' => $application->grant_revision + 1]);
            $application->tokens()->delete();
            WebhookDispatch::cancel($application->id, 'Application grants changed: a granted site was deleted.');
            DeviceAudit::record('application.grants_updated', $application->organization_id, $actor, $application->uuid, [
                'reason' => 'site_deleted', 'site_uuid' => $site->uuid, 'site_name' => $site->name, 'site_uuids' => $remaining,
            ]);
        }
    }
}
