<?php

declare(strict_types=1);

namespace App\Domain\Agents\Mcp;

use App\Domain\Shared\Models\Organization;

/** Links into the portal, so agents can send people where live actions happen. */
final class PortalUrls
{
    public function organization(Organization $organization, string $path = ''): string
    {
        return rtrim((string) config('app.frontend_url'), '/').'/organizations/'.$organization->uuid.($path === '' ? '' : '/'.ltrim($path, '/'));
    }
}
