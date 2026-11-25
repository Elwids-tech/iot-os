<?php

declare(strict_types=1);

use App\Domain\Entities\Models\EntityType;
use App\Domain\Entities\Services\EntityTypes;
use App\Domain\Entities\Services\PathNames;
use App\Domain\Shared\Models\Organization;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Sites become top-level entities of the Site type (spec 009 PR 2, research R4).
 *
 * Each site keeps its UUID, name, time zone, address and coordinates. Each device with
 * a site is placed at it, with no start ("since before placement history was kept");
 * an archived device's placement is ended at its last update, and it keeps the site as
 * its anchor (R5). `devices.site_id` and the move's target point at entities from now
 * on. The old table is kept, unused, as `legacy_sites` for one release so this can be
 * rolled back; `down()` restores it and forgets the placements.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('entity_placements', function (Blueprint $t): void {
            $t->id();
            $t->uuid('uuid')->unique();
            $t->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $t->foreignId('device_id')->constrained('devices')->cascadeOnDelete();
            $t->foreignId('entity_id')->constrained('entities');
            $t->json('leaf_names')->nullable();
            $t->timestamp('started_at')->nullable();
            $t->timestamp('ended_at')->nullable();
            $t->string('end_reason', 24)->nullable();
            $t->foreignId('started_by')->nullable()->constrained('users')->nullOnDelete();
            $t->foreignId('ended_by')->nullable()->constrained('users')->nullOnDelete();
            $t->index(['device_id', 'ended_at']);
        });
        // One current placement per device (FR-009).
        DB::statement('CREATE UNIQUE INDEX entity_placements_current ON entity_placements (device_id) WHERE ended_at IS NULL');
        DB::statement('CREATE INDEX entity_placements_current_entity ON entity_placements (entity_id) WHERE ended_at IS NULL');

        // An organization's deletion removes its types and entities in one statement; RESTRICT
        // would refuse that midway, NO ACTION checks once the statement is done.
        Schema::table('entities', function (Blueprint $t): void {
            $t->dropForeign(['entity_type_id']);
            $t->dropForeign(['parent_id']);
        });
        Schema::table('entities', function (Blueprint $t): void {
            $t->foreign('entity_type_id')->references('id')->on('entity_types');
            $t->foreign('parent_id')->references('id')->on('entities');
        });

        // Fresh columns filled site by site, then swapped in, so an entity id that equals a
        // site id still to be mapped can never be remapped twice.
        Schema::table('devices', function (Blueprint $t): void {
            $t->unsignedBigInteger('entity_id')->nullable();
        });
        Schema::table('device_move_devices', function (Blueprint $t): void {
            $t->unsignedBigInteger('target_entity_id')->nullable();
        });
        foreach ($this->sitesToEntities() as $siteId => $entityId) {
            DB::table('devices')->where('site_id', $siteId)->update(['entity_id' => $entityId]);
            DB::table('device_move_devices')->where('target_site_id', $siteId)->update(['target_entity_id' => $entityId]);
        }
        Schema::table('devices', function (Blueprint $t): void {
            $t->dropForeign(['site_id']);
        });
        // Every migrated device sits directly at its site, so its site is its anchor.
        DB::table('devices')->update(['site_id' => DB::raw('entity_id')]);
        Schema::table('devices', function (Blueprint $t): void {
            $t->foreign('site_id')->references('id')->on('entities')->nullOnDelete();
            $t->foreign('entity_id')->references('id')->on('entities')->nullOnDelete();
            $t->index(['organization_id', 'entity_id']);
        });
        Schema::table('device_move_devices', function (Blueprint $t): void {
            $t->dropForeign(['target_site_id']);
        });
        Schema::table('device_move_devices', function (Blueprint $t): void {
            $t->dropColumn('target_site_id');
            $t->foreign('target_entity_id')->references('id')->on('entities')->nullOnDelete();
        });

        $now = now();
        DB::table('devices')->whereNotNull('entity_id')->orderBy('id')->select(['id', 'organization_id', 'entity_id', 'lifecycle', 'updated_at'])
            ->chunkById(500, function ($devices) use ($now): void {
                DB::table('entity_placements')->insert($devices->map(fn ($device): array => [
                    'uuid' => (string) Str::uuid(), 'organization_id' => $device->organization_id, 'device_id' => $device->id,
                    'entity_id' => $device->entity_id, 'leaf_names' => null, 'started_at' => null,
                    'ended_at' => $device->lifecycle === 'archived' ? ($device->updated_at ?? $now) : null,
                    'end_reason' => $device->lifecycle === 'archived' ? 'device_archived' : null,
                ])->all());
            });

        Schema::rename('sites', 'legacy_sites');
    }

    public function down(): void
    {
        Schema::rename('legacy_sites', 'sites');
        // Back to the site rows by UUID, through fresh columns as on the way up; places that
        // were never sites are forgotten.
        Schema::table('devices', function (Blueprint $t): void {
            $t->unsignedBigInteger('site_id_restored')->nullable();
        });
        Schema::table('device_move_devices', function (Blueprint $t): void {
            $t->unsignedBigInteger('target_site_id')->nullable();
        });
        $sites = DB::table('sites')->pluck('id', 'uuid');
        foreach (DB::table('entities')->whereIn('uuid', $sites->keys())->pluck('uuid', 'id') as $entityId => $uuid) {
            DB::table('devices')->where('site_id', $entityId)->update(['site_id_restored' => $sites[$uuid]]);
            DB::table('device_move_devices')->where('target_entity_id', $entityId)->update(['target_site_id' => $sites[$uuid]]);
        }
        Schema::table('devices', function (Blueprint $t): void {
            $t->dropForeign(['site_id']);
            $t->dropForeign(['entity_id']);
            $t->dropIndex(['organization_id', 'entity_id']);
        });
        DB::table('devices')->update(['site_id' => DB::raw('site_id_restored')]);
        Schema::table('devices', function (Blueprint $t): void {
            $t->dropColumn(['entity_id', 'site_id_restored']);
        });
        Schema::table('devices', function (Blueprint $t): void {
            $t->foreign('site_id')->references('id')->on('sites')->nullOnDelete();
        });
        Schema::table('device_move_devices', function (Blueprint $t): void {
            $t->dropForeign(['target_entity_id']);
        });
        Schema::table('device_move_devices', function (Blueprint $t): void {
            $t->dropColumn('target_entity_id');
            $t->foreign('target_site_id')->references('id')->on('sites')->nullOnDelete();
        });
        Schema::dropIfExists('entity_placements');
        // The migrated Site entities go with whatever was built under them; other entities stay.
        $migrated = DB::table('entities')->whereIn('uuid', $sites->keys())->pluck('id');
        $branches = DB::table('entity_closure')->whereIn('ancestor_id', $migrated)->pluck('descendant_id')->unique()->values();
        DB::table('entity_changes')->whereIn('entity_id', $branches)->delete();
        DB::table('entity_closure')->whereIn('descendant_id', $branches)->delete();
        DB::table('entities')->whereIn('id', $branches)->delete();
        Schema::table('entities', function (Blueprint $t): void {
            $t->dropForeign(['entity_type_id']);
            $t->dropForeign(['parent_id']);
        });
        Schema::table('entities', function (Blueprint $t): void {
            $t->foreign('entity_type_id')->references('id')->on('entity_types')->restrictOnDelete();
            $t->foreign('parent_id')->references('id')->on('entities')->restrictOnDelete();
        });
    }

    /**
     * One top-level Site entity per site, with the same UUID.
     *
     * @return array<int, int> site id => entity id
     */
    private function sitesToEntities(): array
    {
        $map = [];
        $types = app(EntityTypes::class);
        foreach (DB::table('sites')->orderBy('organization_id')->orderBy('id')->get() as $site) {
            $organization = Organization::withTrashed()->find($site->organization_id);
            if (! $organization) {
                continue;
            }
            $type = EntityType::query()->where('organization_id', $organization->id)->where('key', EntityType::SITE)->first() ?? $types->ensureSite($organization);
            $pathName = $this->freePathName($organization->id, $site->name);
            $id = DB::table('entities')->insertGetId([
                'uuid' => $site->uuid, 'organization_id' => $organization->id, 'entity_type_id' => $type->id, 'parent_id' => null,
                'name' => $site->name, 'path_name' => $pathName, 'depth' => 0, 'path' => $pathName,
                'timezone' => $site->timezone, 'address' => $site->address, 'latitude' => $site->latitude, 'longitude' => $site->longitude,
                'custom_attributes' => null, 'created_by' => $site->created_by, 'updated_by' => $site->updated_by,
                'created_at' => $site->created_at, 'updated_at' => $site->updated_at,
            ]);
            DB::table('entity_closure')->insert(['ancestor_id' => $id, 'descendant_id' => $id, 'depth' => 0]);
            DB::table('entity_changes')->insert([
                'organization_id' => $organization->id, 'entity_id' => $id, 'kind' => 'created', 'new_path_name' => $pathName,
                'new_type_id' => $type->id, 'user_id' => $site->created_by, 'changed_at' => $site->created_at ?? now(),
            ]);
            $map[(int) $site->id] = $id;
        }

        return $map;
    }

    /** The suggested path name, or `Site<n>` when it gives nothing or is taken at the top level. */
    private function freePathName(int $organizationId, string $name): string
    {
        $taken = fn (string $candidate): bool => DB::table('entities')->where('organization_id', $organizationId)->whereNull('parent_id')
            ->whereNull('archived_at')->whereRaw('lower(path_name) = ?', [strtolower($candidate)])->exists();
        $suggested = PathNames::suggest($name);
        if ($suggested !== '' && ! $taken($suggested)) {
            return $suggested;
        }
        for ($n = 1; ; $n++) {
            if (! $taken('Site'.$n)) {
                return 'Site'.$n;
            }
        }
    }
};
