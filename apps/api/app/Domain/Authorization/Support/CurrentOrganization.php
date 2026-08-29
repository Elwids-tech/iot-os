<?php

declare(strict_types=1);

namespace App\Domain\Authorization\Support;

use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use LogicException;

final class CurrentOrganization
{
    public static function from(Request $request): Organization
    {
        $organization = $request->attributes->get('organization');
        if (! $organization instanceof Organization) {
            throw new LogicException('Organization context has not been resolved.');
        }

        return $organization;
    }
}
