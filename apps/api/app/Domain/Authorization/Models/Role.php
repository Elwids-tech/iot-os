<?php

declare(strict_types=1);

namespace App\Domain\Authorization\Models;

use App\Domain\Shared\Models\Organization;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Spatie\Permission\Models\Role as SpatieRole;

/**
 * @property int|null $organization_id
 * @property Organization|null $organization
 * @property string $display_name
 * @property bool $is_default
 */
class Role extends SpatieRole
{
    /**
     * @return BelongsTo<Organization, $this>
     */
    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }
}
