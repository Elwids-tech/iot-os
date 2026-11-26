<?php

declare(strict_types=1);

namespace App\Domain\Entities\Services;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Entities\Exceptions\HierarchyRuleBroken;
use App\Domain\Entities\Models\Entity;
use App\Domain\Entities\Models\EntityMembership;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Groupings across the tree (spec 009, FR-023): `Feeder12` is a member of
 * `EastDivision` while staying where it is. One current membership per member and group
 * type, so joining a second division ends the first. Coverage follows them one step.
 */
final class Memberships
{
    public function join(Entity $member, Entity $group, ?User $actor): EntityMembership
    {
        return DB::transaction(function () use ($member, $group, $actor): EntityMembership {
            EntityTree::lock($member->organization);
            $member = Entity::query()->with('type')->whereKey($member->id)->firstOrFail();
            $group = Entity::query()->with('type')->whereKey($group->id)->firstOrFail();
            if ($group->organization_id !== $member->organization_id) {
                throw HierarchyRuleBroken::rule('not_found', 'group_uuid', 'Choose a group in this organization.');
            }
            if ($member->isArchived() || $group->isArchived()) {
                throw HierarchyRuleBroken::rule('archived', 'group_uuid', 'Archived entities cannot join or hold members.');
            }
            if ($member->id === $group->id) {
                throw HierarchyRuleBroken::rule('related', 'group_uuid', 'An entity cannot be a member of itself.');
            }
            $contains = fn (Entity $outer, Entity $inner) => DB::table('entity_closure')->where('ancestor_id', $outer->id)->where('descendant_id', $inner->id)->exists();
            if ($contains($member, $group) || $contains($group, $member)) {
                [$outer, $inner] = $contains($member, $group) ? [$member, $group] : [$group, $member];
                throw HierarchyRuleBroken::rule('related', 'group_uuid', "{$inner->name} is inside {$outer->name}: the tree already relates them.");
            }
            if (! in_array($member->type->key, $group->type->member_type_keys ?? [], true)) {
                throw HierarchyRuleBroken::rule('member_type', 'group_uuid', "A {$group->type->name} cannot hold a {$member->type->name} as a member.");
            }
            $current = EntityMembership::query()->where('member_id', $member->id)->where('group_type_id', $group->entity_type_id)->whereNull('ended_at')->lockForUpdate()->first();
            if ($current?->group_id === $group->id) {
                return $current;
            }
            $now = now();
            if ($current) {
                $this->close($current, $member, 'replaced', $actor, $now);
            }
            $membership = EntityMembership::create([
                'organization_id' => $member->organization_id, 'member_id' => $member->id, 'group_id' => $group->id,
                'group_type_id' => $group->entity_type_id, 'started_at' => $now, 'started_by' => $actor?->id,
            ]);
            ActivityLog::record('entity.membership_started', $member->organization_id, $actor, $member, ['member' => $member->path, 'group' => $group->path]);

            return $membership;
        });
    }

    public function leave(Entity $member, Entity $group, ?User $actor): void
    {
        DB::transaction(function () use ($member, $group, $actor): void {
            EntityTree::lock($member->organization);
            $current = EntityMembership::query()->where('member_id', $member->id)->where('group_id', $group->id)->whereNull('ended_at')->lockForUpdate()->first();
            $current && $this->close($current, $member, 'left', $actor, now());
        });
    }

    /** Archiving either side ends its memberships at that time; the caller holds the tree lock. */
    public function archived(Entity $entity, ?User $actor): void
    {
        $now = now();
        EntityMembership::query()->with('member')->whereNull('ended_at')->where(fn ($q) => $q->where('member_id', $entity->id)->orWhere('group_id', $entity->id))
            ->lockForUpdate()->get()->each(fn (EntityMembership $membership) => $this->close($membership, $membership->member, 'archived', $actor, $now));
    }

    private function close(EntityMembership $membership, Entity $member, string $reason, ?User $actor, \DateTimeInterface $at): void
    {
        $membership->forceFill(['ended_at' => $at, 'end_reason' => $reason, 'ended_by' => $actor?->id])->save();
        ActivityLog::record('entity.membership_ended', $member->organization_id, $actor, $member, ['member' => $member->path, 'group' => $membership->group()->value('path'), 'reason' => $reason]);
    }
}
