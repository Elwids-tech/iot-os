<?php
// Spec 009 quickstart C: checks, then applies, a building batch through HierarchyOperations
// against the local stack's database. Run inside the api container:
//   docker cp tooling/verify-entity-batch.php iot-os-dev-api-1:/tmp/ && docker exec iot-os-dev-api-1 php /tmp/verify-entity-batch.php
// Works in a temporary organization it creates and deletes; existing organizations are untouched.
declare(strict_types=1);

use App\Domain\Administration\Services\OrganizationDefaultRoles;
use App\Domain\Devices\Models\Device;
use App\Domain\Entities\Services\Batch\EntityRef;
use App\Domain\Entities\Services\Batch\HierarchyBatch;
use App\Domain\Entities\Services\Batch\NewEntityItem;
use App\Domain\Entities\Services\Batch\PlacementItem;
use App\Domain\Entities\Services\EntityPresets;
use App\Domain\Entities\Services\HierarchyOperations;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

require '/var/www/html/vendor/autoload.php';
$app = require '/var/www/html/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (! $app->environment('local', 'testing') || DB::getDriverName() !== 'pgsql') {
    throw new RuntimeException('Local PostgreSQL required.');
}
$check = static function (bool $ok, string $label): void {
    echo ($ok ? 'PASS ' : 'FAIL ').$label.PHP_EOL;
    if (! $ok) {
        throw new RuntimeException($label);
    }
};
$counts = static fn (): array => array_map(fn (string $table): int => DB::table($table)->count(), ['entities' => 'entities', 'entity_placements' => 'entity_placements', 'activity_log' => 'activity_log']);

$organization = Organization::create(['name' => 'Temporary hierarchy batch check', 'slug' => 'entity-batch-'.Str::uuid()]);
try {
    app(OrganizationDefaultRoles::class)->ensure($organization);
    $actor = User::where('is_super_admin', true)->firstOrFail();
    $operations = app(HierarchyOperations::class);
    app(EntityPresets::class)->apply($organization, 'buildings', $actor);
    $site = $operations->createEntity($organization, new NewEntityItem('site', 'site', 'Example campus', timezone: 'UTC'), $actor);
    $devices = [];
    for ($n = 1; $n <= 20; $n++) {
        $devices[] = Device::create(['organization_id' => $organization->id, 'code' => "zone-controller-{$n}", 'name' => "Zone controller {$n}"]);
    }
    $batch = static function (bool $broken) use ($site, $devices): HierarchyBatch {
        $items = [new NewEntityItem('building', 'building', 'Example Tower', parent: EntityRef::existing($site->uuid))];
        foreach (range(1, 4) as $floor) {
            $items[] = new NewEntityItem("floor-{$floor}", 'floor', "Floor {$floor}", parent: EntityRef::item('building'));
            foreach (range(1, 4) as $zone) {
                $items[] = new NewEntityItem("zone-{$floor}-{$zone}", 'zone', "Zone {$floor}-{$zone}", parent: EntityRef::item($broken && $floor === 2 && $zone === 3 ? 'building' : "floor-{$floor}"));
            }
        }
        foreach ($devices as $i => $device) {
            $items[] = new PlacementItem("place-{$i}", $device->uuid, $i < 16 ? EntityRef::item('zone-'.(intdiv($i, 4) + 1).'-'.($i % 4 + 1)) : EntityRef::item('floor-'.($i - 15)));
        }

        return new HierarchyBatch($items);
    };

    $before = $counts();
    $started = microtime(true);
    $checked = $operations->check($organization, $batch(false), $actor);
    $seconds = microtime(true) - $started;
    $check($checked->accepted() && count($checked->items) === 41, 'check: 41 items accepted');
    $check($counts() === $before, 'check: nothing saved, nothing logged');
    $check($seconds < 2, sprintf('check: %.2f s (SC-007 under 2 s)', $seconds));

    $refused = $operations->check($organization, $batch(true), $actor)->refused();
    $check(array_map(fn ($item) => [$item->ref, $item->rule], $refused) === [['zone-2-3', 'parent_type'], ['place-6', 'parent_refused']], 'check: the broken zone and its placement are refused with the rule');
    $check(! $operations->apply($organization, $batch(true), $actor)->applied && $counts() === $before, 'apply of the refused batch commits nothing');

    $applied = $operations->apply($organization, $batch(false), $actor);
    $check($applied->applied, 'apply: committed');
    $tagged = DB::table('activity_log')->where('organization_id', $organization->id)->whereRaw("properties->>'batch' = ?", [$applied->batchUuid])->count();
    $check($tagged === 41, 'apply: one activity entry per change, tagged with the batch');
    $check(DB::table('entity_placements')->where('organization_id', $organization->id)->whereNull('ended_at')->count() === 20, 'apply: 20 devices placed');
} finally {
    DB::table('activity_log')->where('organization_id', $organization->id)->delete();
    Device::where('organization_id', $organization->id)->delete();
    $organization->forceDelete();
    echo 'temporary organization removed'.PHP_EOL;
}
