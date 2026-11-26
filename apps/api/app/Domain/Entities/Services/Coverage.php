<?php

declare(strict_types=1);

namespace App\Domain\Entities\Services;

use App\Domain\Entities\Models\Entity;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * An entity's coverage (spec 009, FR-016, FR-023): its branch, plus the branches of its
 * current members, one step only, so groupings cannot loop. Device filters use it as a
 * subquery, so a large branch never travels through PHP.
 */
final class Coverage
{
    /** The ids of every entity in the coverage, as a subquery. */
    public static function entityIds(Entity $entity): Builder
    {
        return DB::table('entity_closure')->select('descendant_id')->where('ancestor_id', $entity->id)
            ->union(DB::table('entity_closure')->select('entity_closure.descendant_id')
                ->join('entity_memberships', 'entity_memberships.member_id', '=', 'entity_closure.ancestor_id')
                ->where('entity_memberships.group_id', $entity->id)->whereNull('entity_memberships.ended_at'));
    }

    /**
     * The ids of devices placed in the coverage (an archived device by its last placement),
     * or with a parameter placed there now, as a subquery.
     */
    public static function deviceIds(Entity $entity): Builder
    {
        $entities = self::entityIds($entity);

        return DB::table('devices')->select('id')->where('organization_id', $entity->organization_id)->whereIn('entity_id', $entities)
            ->union(DB::table('parameter_placements')->select('device_id')->whereNull('ended_at')->whereIn('entity_id', self::entityIds($entity)));
    }
}
