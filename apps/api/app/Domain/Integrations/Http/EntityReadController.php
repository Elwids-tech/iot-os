<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Http;

use App\Domain\Integrations\Services\ApplicationGrant;
use App\Domain\Integrations\Services\ApplicationGrants;
use App\Domain\Shared\Models\Organization;
use Dedoc\Scramble\Attributes\QueryParameter;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/** The hierarchy an application may see, under `entities:read` (spec 009, FR-026). */
final class EntityReadController
{
    public const PER_PAGE = 100;

    /**
     * The entities the application may see, 100 a page, ordered by path: each scoped
     * entity's branch (`in_scope: true`) and the ancestors that complete their paths
     * (`in_scope: false`, their other devices are not granted). A device list sees the
     * places of its devices and their ancestors, all `in_scope: false`. Pass `next_cursor`
     * back as `cursor` for the next page; it is null on the last.
     *
     * @return array{schema_version: 'integration-entities.v1', data: list<array{uuid: string, name: string, path: string, type_key: string, parent_uuid: string|null, in_scope: bool}>, next_cursor: string|null}
     */
    #[QueryParameter('cursor', description: 'The `next_cursor` of the previous page.', type: 'string')]
    public function entities(Request $request, Organization $organization): array
    {
        $input = $request->validate(['cursor' => 'sometimes|string|max:2048']);
        $after = isset($input['cursor']) ? json_decode((string) base64_decode(strtr($input['cursor'], '-_', '+/'), true), true) : null;
        if (isset($input['cursor']) && ! (is_array($after) && is_string($after[0] ?? null) && is_int($after[1] ?? null))) {
            throw ValidationException::withMessages(['cursor' => 'The cursor is not valid.']);
        }

        $grant = ApplicationGrants::for($request->attributes->get('integration_application'));
        $rows = DB::table('entities as e')
            ->joinSub($this->visible($grant), 'v', 'v.entity_id', '=', 'e.id')
            ->join('entity_types as t', 't.id', '=', 'e.entity_type_id')
            ->leftJoin('entities as p', 'p.id', '=', 'e.parent_id')
            ->where('e.organization_id', $organization->id)->whereNull('e.archived_at')
            ->when($after, fn ($query) => $query->whereRaw('(e.path, e.id) > (?, ?)', $after))
            ->orderBy('e.path')->orderBy('e.id')->limit(self::PER_PAGE + 1)
            ->get(['e.id', 'e.uuid', 'e.name', 'e.path', 't.key as type_key', 'p.uuid as parent_uuid', 'v.in_scope']);
        $more = $rows->count() > self::PER_PAGE;
        $rows = $rows->take(self::PER_PAGE);
        $last = $rows->last();

        return [
            'schema_version' => 'integration-entities.v1',
            'data' => $rows->map(fn ($row) => [
                'uuid' => (string) $row->uuid, 'name' => (string) $row->name, 'path' => (string) $row->path, 'type_key' => (string) $row->type_key,
                'parent_uuid' => $row->parent_uuid === null ? null : (string) $row->parent_uuid, 'in_scope' => (bool) $row->in_scope,
            ])->values()->all(),
            'next_cursor' => $more && $last ? rtrim(strtr(base64_encode((string) json_encode([$last->path, (int) $last->id])), '+/', '-_'), '=') : null,
        ];
    }

    /** Entity ids with whether any scope covers them: scoped branches, then the ancestors above. */
    private function visible(ApplicationGrant $grant)
    {
        if ($grant->kind() === ApplicationGrant::DEVICES) {
            $anchors = $grant->deviceQuery()->toBase()->whereNotNull('entity_id')->select('entity_id');

            return DB::table('entity_closure')->whereIn('descendant_id', $anchors)->groupBy('ancestor_id')
                ->selectRaw('ancestor_id as entity_id, false as in_scope');
        }
        $branch = DB::table('entity_closure')->whereIn('ancestor_id', $grant->scopedQuery())->selectRaw('descendant_id as entity_id, true as in_scope');
        $above = DB::table('entity_closure')->whereIn('descendant_id', $grant->scopedQuery())->selectRaw('ancestor_id as entity_id, false as in_scope');

        return DB::query()->fromSub($branch->unionAll($above), 'u')->groupBy('entity_id')->selectRaw('entity_id, bool_or(in_scope) as in_scope');
    }
}
