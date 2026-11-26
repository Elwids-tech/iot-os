<?php

declare(strict_types=1);

namespace App\Domain\Entities\Console;

use App\Domain\Devices\Services\DeviceDirectory;
use App\Domain\Entities\Http\Controllers\EntityController;
use App\Domain\Entities\Models\Entity;
use App\Domain\Entities\Models\EntityType;
use App\Domain\Entities\Services\EntityTree;
use App\Domain\Entities\Services\EntityTypes;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Console\Command;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Local only: fills an organization with a large hierarchy and placed devices, then times
 * what SC-003 promises (spec 009): a branch's children, a search, and a 50-entity scope.
 * Everything it makes sits under one Site named `Scale`; `--remove` takes it out again.
 */
final class SeedScale extends Command
{
    protected $signature = 'entities:seed-scale {organization : the organization UUID}
        {--entities=100000 : entities to create under the Scale site}
        {--devices=20000 : devices to create and place}
        {--measure : only time the queries against an existing Scale site}
        {--remove : remove the Scale site, its branch, its devices and the scale type}';

    protected $description = 'Local only: seed a large entity hierarchy and time SC-003 (spec 009)';

    private const TYPE = 'scale_node';

    private const FANOUT = 10;

    public function handle(): int
    {
        if (! app()->environment(['local', 'testing'])) {
            $this->error('entities:seed-scale runs only in the local or testing environment.');

            return self::FAILURE;
        }
        $organization = Organization::query()->where('uuid', $this->argument('organization'))->firstOrFail();
        $actor = $organization->users()->orderBy('users.id')->firstOrFail();
        if ($this->option('remove')) {
            $this->remove($organization);

            return self::SUCCESS;
        }
        if (! $this->option('measure')) {
            if ($this->site($organization)) {
                $this->error('This organization already has a Scale site: --measure it or --remove it first.');

                return self::FAILURE;
            }
            $this->seed($organization, $actor, max(1, (int) $this->option('entities')), max(0, (int) $this->option('devices')));
        }
        $this->measure($organization, $actor);

        return self::SUCCESS;
    }

    private function seed(Organization $organization, User $actor, int $entities, int $devices): void
    {
        $started = microtime(true);
        app(EntityTypes::class)->ensureSite($organization);
        $type = EntityType::query()->firstOrCreate(['organization_id' => $organization->id, 'key' => self::TYPE], [
            'name' => 'Scale node', 'parent_type_keys' => [EntityType::SITE, self::TYPE], 'member_type_keys' => [self::TYPE],
            'accepts_devices' => true, 'preset_keys' => [], 'created_by' => $actor->id,
        ]);
        $site = app(EntityTree::class)->create($organization, ['type_key' => EntityType::SITE, 'name' => 'Scale', 'timezone' => 'UTC'], $actor, false);
        $this->info("Site {$site->path} ({$site->uuid})");
        $level = collect([$site->id]);
        $made = 0;
        for ($depth = $site->depth + 1; $made < $entities; $depth++) {
            $perParent = min(self::FANOUT, (int) ceil(($entities - $made) / $level->count()));
            $count = min($entities - $made, $level->count() * $perParent);
            // One statement per level: each parent gets up to FANOUT children named Node <n>, paths from the parent's.
            $ids = collect(DB::select(<<<'SQL'
                insert into entities (uuid, organization_id, entity_type_id, parent_id, name, path_name, depth, path, created_by, updated_by, created_at, updated_at)
                select gen_random_uuid(), ?, ?, p.id, 'Node ' || (? + row_number() over ()), 'Node' || (? + row_number() over ()), ?,
                       p.path || '/Node' || (? + row_number() over ()), ?, ?, now(), now()
                from (select id, path from entities where id = any(?::bigint[])) p cross join generate_series(1, ?) g
                limit ?
                returning id
                SQL, [$organization->id, $type->id, $made, $made, $depth, $made, $actor->id, $actor->id, '{'.$level->implode(',').'}', $perParent, $count]))->pluck('id');
            DB::statement(<<<'SQL'
                insert into entity_closure (ancestor_id, descendant_id, depth)
                select c.ancestor_id, e.id, c.depth + 1 from entities e join entity_closure c on c.descendant_id = e.parent_id where e.id = any(?::bigint[])
                union all select id, id, 0 from entities where id = any(?::bigint[])
                SQL, ['{'.$ids->implode(',').'}', '{'.$ids->implode(',').'}']);
            $made += $ids->count();
            $level = $ids;
            $this->line("  depth {$depth}: {$ids->count()} entities ({$made} in all)");
        }
        if ($devices > 0) {
            // Devices go round the deepest level; their site is the Scale site.
            DB::statement(<<<'SQL'
                with leaves as (select id, row_number() over (order by id) - 1 as n, count(*) over () as total from entities where id = any(?::bigint[])),
                made as (
                    insert into devices (uuid, organization_id, code, name, entity_id, site_id, created_at, updated_at)
                    select gen_random_uuid(), ?, 'scale-' || g, 'Scale device ' || g, l.id, ?, now(), now()
                    from generate_series(1, ?) g
                    join leaves l on l.n = (g - 1) % l.total
                    returning id, entity_id
                )
                insert into entity_placements (uuid, organization_id, device_id, entity_id, started_at, started_by)
                select gen_random_uuid(), ?, id, entity_id, now(), ? from made
                SQL, ['{'.$level->implode(',').'}', $organization->id, $site->id, $devices, $organization->id, $actor->id]);
            $this->line("  {$devices} devices placed");
        }
        DB::statement('analyze entities');
        DB::statement('analyze entity_closure');
        DB::statement('analyze devices');
        $this->info(sprintf('Seeded in %.1f s.', microtime(true) - $started));
    }

    private function measure(Organization $organization, User $actor): void
    {
        $site = $this->site($organization) ?? throw new \RuntimeException('No Scale site: seed one first.');
        $total = DB::table('entity_closure')->where('ancestor_id', $site->id)->count();
        $placed = DB::table('devices')->where('site_id', $site->id)->count();
        $this->info("Scale site: {$total} entities in its branch, {$placed} devices.");
        $deep = Entity::query()->whereIn('id', DB::table('entity_closure')->select('descendant_id')->where('ancestor_id', $site->id)->where('depth', 3))->inRandomOrder()->first();
        $controller = app(EntityController::class);
        $request = fn (array $query) => tap(Request::create('/', 'GET', $query), fn (Request $r) => $r->setUserResolver(fn () => $actor));
        $rows = [];
        foreach ([['children of the site', ['parent' => $site->uuid]], ['children at depth 3', ['parent' => $deep?->uuid]]] as [$label, $query]) {
            $rows[] = [$label, $this->time(fn () => $controller->index($request($query), $organization)->toResponse($request($query))), '< 1000 ms'];
        }
        $needle = (string) random_int(1000, 9999);
        $rows[] = ["search \"{$needle}\"", $this->time(fn () => $controller->search($request(['q' => $needle]), $organization)->toResponse($request(['q' => $needle]))), '< 2000 ms'];
        $rows[] = ['search "node 5"', $this->time(fn () => $controller->search($request(['q' => 'node 5']), $organization)->toResponse($request(['q' => 'node 5']))), '< 2000 ms'];
        $first = Entity::query()->where('parent_id', $site->id)->orderBy('id')->first();
        $rows[] = ['devices in a depth-1 coverage (count + page)', $this->time(function () use ($organization, $first): void {
            $query = app(DeviceDirectory::class)->query($organization, ['entity_uuid' => $first->uuid]);
            $query->count();
            $query->limit(25)->get();
        }), 'informative'];
        // A 50-entity scope: the devices under 50 entities, as a grant by entity resolves them.
        $fifty = DB::table('entity_closure')->where('ancestor_id', $site->id)->where('depth', 3)->inRandomOrder()->limit(50)->pluck('descendant_id')->all();
        $rows[] = ['resolve a 50-entity scope', $this->time(fn () => DB::table('devices')->whereIn('entity_id', DB::table('entity_closure')->select('descendant_id')->whereIn('ancestor_id', $fifty))->pluck('id')), '< 50 ms'];
        $this->table(['Query', 'Median of 5 (ms)', 'SC-003'], $rows);
    }

    private function time(\Closure $run): string
    {
        $run();
        $times = [];
        for ($i = 0; $i < 5; $i++) {
            $started = hrtime(true);
            $run();
            $times[] = (hrtime(true) - $started) / 1e6;
        }
        sort($times);

        return number_format($times[2], 1);
    }

    private function remove(Organization $organization): void
    {
        $site = $this->site($organization);
        DB::transaction(function () use ($organization, $site): void {
            if ($site) {
                $branch = DB::table('entity_closure')->select('descendant_id')->where('ancestor_id', $site->id);
                $devices = DB::table('devices')->select('id')->where('organization_id', $organization->id)->where('code', 'like', 'scale-%')->whereIn('entity_id', $branch);
                DB::table('entity_placements')->whereIn('device_id', $devices)->delete();
                DB::table('devices')->whereIn('id', $devices)->delete();
                DB::table('entity_changes')->whereIn('entity_id', $branch)->delete();
                $ids = $branch->pluck('descendant_id')->all();
                foreach (array_chunk($ids, 10000) as $chunk) {
                    DB::table('entity_closure')->whereIn('descendant_id', $chunk)->delete();
                }
                // Deepest first, so no row outlives its parent.
                DB::table('entities')->whereIn('id', $ids)->orderByDesc('depth')->pluck('id')->chunk(10000)->each(fn ($chunk) => DB::table('entities')->whereIn('id', $chunk->all())->delete());
            }
            EntityType::query()->where('organization_id', $organization->id)->where('key', self::TYPE)->whereDoesntHave('entities')->delete();
        });
        $this->info($site ? 'Removed the Scale site and everything under it.' : 'No Scale site to remove.');
    }

    private function site(Organization $organization): ?Entity
    {
        return Entity::query()->where('organization_id', $organization->id)->whereNull('parent_id')->where('path_name', 'Scale')->whereNull('archived_at')->first();
    }
}
