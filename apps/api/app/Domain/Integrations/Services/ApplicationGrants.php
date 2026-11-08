<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Services;

use App\Domain\Devices\Models\Site;
use App\Domain\Devices\Services\DeviceAudit;
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
