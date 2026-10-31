<?php

declare(strict_types=1);

namespace App\Domain\Audit\Models;

use App\Domain\Shared\Models\Organization;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Spatie\Activitylog\Models\Activity as SpatieActivity;

/**
 * One audit event (ADR-028): `event` is the action code, `causer` the acting user or
 * none for system events, and `organization_id` the organization whose data changed.
 * `subject_uuid` and `subject_name` keep the subject findable and named after it is
 * gone; `properties` holds the details.
 *
 * @property int|null $organization_id
 * @property string|null $subject_uuid
 * @property string|null $subject_name
 */
class Activity extends SpatieActivity
{
    /**
     * @return BelongsTo<Organization, $this>
     */
    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class)->withTrashed();
    }
}
