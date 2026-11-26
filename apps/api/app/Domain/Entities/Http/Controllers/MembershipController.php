<?php

declare(strict_types=1);

namespace App\Domain\Entities\Http\Controllers;

use App\Domain\Entities\Exceptions\HierarchyRuleBroken;
use App\Domain\Entities\Models\Entity;
use App\Domain\Entities\Models\EntityMembership;
use App\Domain\Entities\Permissions\EntityPermission;
use App\Domain\Entities\Services\EntityAuthorization;
use App\Domain\Entities\Services\Memberships;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/** Groupings across the tree: an entity as a member of others, and the members it holds (spec 009 FR-023). */
final class MembershipController
{
    public function __construct(private readonly EntityAuthorization $authorization) {}

    /**
     * The groups the entity belongs to and the members it holds, current first, with history.
     *
     * @return array{data: array{groups: list<array{group: array{uuid: string, name: string, path: string, type_key: string}, started_at: string|null, ended_at: string|null, end_reason: string|null}>, members: list<array{member: array{uuid: string, name: string, path: string, type_key: string}, started_at: string|null, ended_at: string|null, end_reason: string|null}>}}
     */
    public function index(Request $request, Organization $organization, Entity $entity): array
    {
        $this->authorization->authorize($request->user(), EntityPermission::VIEW, $organization, $entity);
        $rows = fn (string $side, string $other) => EntityMembership::query()->with("$other.type")->where("{$side}_id", $entity->id)
            ->orderByRaw('ended_at is not null')->orderByDesc('started_at')->orderByDesc('id')->get()
            ->map(fn (EntityMembership $membership): array => [
                $other => ['uuid' => (string) $membership->{$other}->uuid, 'name' => (string) $membership->{$other}->name, 'path' => (string) $membership->{$other}->path, 'type_key' => (string) $membership->{$other}->type->key],
                'started_at' => $membership->started_at?->toIso8601String(),
                'ended_at' => $membership->ended_at?->toIso8601String(),
                'end_reason' => $membership->end_reason,
            ])->values()->all();

        return ['data' => ['groups' => $rows('member', 'group'), 'members' => $rows('group', 'member')]];
    }

    /**
     * Makes the entity a member of a group. A current membership in another group of the
     * same type ends, so a feeder is in one division at a time.
     *
     * @return array{data: array{group: array{uuid: string, name: string, path: string, type_key: string}, started_at: string|null}}
     */
    public function store(Request $request, Organization $organization, Entity $entity): array
    {
        $this->authorization->authorize($request->user(), EntityPermission::MANAGE, $organization, $entity);
        $values = $request->validate(['group_uuid' => ['required', 'uuid']]);
        $group = Entity::query()->with('type')->where('organization_id', $organization->id)->where('uuid', $values['group_uuid'])->first()
            ?? throw HierarchyRuleBroken::rule('not_found', 'group_uuid', 'Choose a group in this organization.');
        $membership = app(Memberships::class)->join($entity->load('organization'), $group, $request->user());

        return ['data' => [
            'group' => ['uuid' => (string) $group->uuid, 'name' => (string) $group->name, 'path' => (string) $group->path, 'type_key' => (string) $group->type->key],
            'started_at' => $membership->started_at?->toIso8601String(),
        ]];
    }

    /** Ends the entity's current membership in that group. */
    public function destroy(Request $request, Organization $organization, Entity $entity, Entity $group): Response
    {
        $this->authorization->authorize($request->user(), EntityPermission::MANAGE, $organization, $entity);
        abort_unless($group->organization_id === $organization->id, 404);
        app(Memberships::class)->leave($entity->load('organization'), $group, $request->user());

        return response()->noContent();
    }
}
