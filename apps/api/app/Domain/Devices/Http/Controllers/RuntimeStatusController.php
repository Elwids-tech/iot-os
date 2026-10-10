<?php

declare(strict_types=1);

namespace App\Domain\Devices\Http\Controllers;

use App\Domain\Devices\Services\RuntimeStatus;
use App\Domain\Shared\Models\Organization;

final class RuntimeStatusController
{
    /** Any member may read it; the organization only scopes access (the runtime is shared). */
    public function __invoke(Organization $organization, RuntimeStatus $status): array
    {
        return ['data' => $status->current()];
    }
}
