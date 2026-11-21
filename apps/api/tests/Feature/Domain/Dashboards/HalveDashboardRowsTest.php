<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Dashboards;

use App\Domain\Shared\Models\Organization;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

final class HalveDashboardRowsTest extends TestCase
{
    use RefreshDatabase;

    public function test_saved_layouts_double_rows_and_heights_and_come_back_on_rollback(): void
    {
        $this->seed(DatabaseSeeder::class);
        $organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $layouts = ['lg' => [['i' => 'a', 'x' => 0, 'y' => 0, 'w' => 6, 'h' => 5], ['i' => 'b', 'x' => 6, 'y' => 3, 'w' => 6, 'h' => 6]], 'xs' => [['i' => 'a', 'x' => 0, 'y' => 7, 'w' => 1, 'h' => 1]]];
        $row = ['organization_id' => $organization->id, 'uuid' => (string) Str::uuid(), 'name' => 'Rows', 'widgets' => '[]', 'layouts' => json_encode($layouts), 'revision' => 1, 'created_at' => now(), 'updated_at' => now()];
        $id = DB::table('dashboards')->insertGetId($row);
        $empty = DB::table('dashboards')->insertGetId([...$row, 'uuid' => (string) Str::uuid(), 'layouts' => '{}']);
        DB::table('dashboard_revisions')->insert(['dashboard_id' => $id, 'revision' => 1, 'name' => 'Rows', 'widgets' => '[]', 'layouts' => json_encode($layouts), 'tags' => '[]', 'created_at' => now(), 'updated_at' => now()]);
        $migration = require database_path('migrations/2026_11_26_000200_halve_dashboard_grid_rows.php');

        $migration->up();
        $doubled = ['lg' => [['i' => 'a', 'x' => 0, 'y' => 0, 'w' => 6, 'h' => 10], ['i' => 'b', 'x' => 6, 'y' => 6, 'w' => 6, 'h' => 12]], 'xs' => [['i' => 'a', 'x' => 0, 'y' => 14, 'w' => 1, 'h' => 2]]];
        $this->assertEquals($doubled, json_decode(DB::table('dashboards')->where('id', $id)->value('layouts'), true));
        $this->assertEquals($doubled, json_decode(DB::table('dashboard_revisions')->where('dashboard_id', $id)->value('layouts'), true));
        $this->assertEquals([], json_decode(DB::table('dashboards')->where('id', $empty)->value('layouts'), true));

        $migration->down();
        $this->assertEquals($layouts, json_decode(DB::table('dashboards')->where('id', $id)->value('layouts'), true));
    }
}
