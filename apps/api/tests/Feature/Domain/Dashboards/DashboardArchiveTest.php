<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Dashboards;

use App\Domain\Dashboards\Services\DashboardDefinition;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** Spec 031 FR-037: archiving and restoring dashboards outside moves. */
final class DashboardArchiveTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private string $url;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->url = '/api/v1/organizations/'.$this->organization->uuid.'/dashboards';
    }

    public function test_an_archived_dashboard_is_hidden_read_only_and_restored_as_it_was(): void
    {
        $this->actAs('acme.moderator@example.test');
        $kept = $this->postJson($this->url, $this->dashboard('Kept'))->assertOk()->json('data.uuid');
        $created = $this->postJson($this->url, $this->dashboard('Line 2'))->assertOk()->json('data');
        $path = $this->url.'/'.$created['uuid'];
        $this->putJson($path.'/star', ['starred' => true])->assertOk();
        $moderator = User::where('email', 'acme.moderator@example.test')->firstOrFail();
        $updated = DB::table('dashboards')->where('uuid', $created['uuid'])->value('updated_at');
        $this->travel(5)->minutes();

        $this->postJson($path.'/archive')->assertOk()
            ->assertJsonPath('data.uuid', $created['uuid'])
            ->assertJsonPath('data.archived_by', ['user_id' => $moderator->id, 'name' => 'Acme Moderator']);
        $this->assertNotNull(DB::table('dashboards')->where('uuid', $created['uuid'])->value('archived_at'));
        // Archiving isn't an edit.
        $this->assertSame($updated, DB::table('dashboards')->where('uuid', $created['uuid'])->value('updated_at'));
        // Archiving twice changes nothing and records nothing more.
        $this->postJson($path.'/archive')->assertOk();
        $this->assertSame(1, DB::table('activity_log')->where('event', 'dashboard.archived')->where('subject_uuid', $created['uuid'])->count());

        // Lists leave it out unless asked, and say how many they leave out.
        $this->getJson($this->url)->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.uuid', $kept)->assertJsonPath('meta.archived_count', 1);
        $this->getJson($this->url.'?archived=only')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.uuid', $created['uuid'])
            ->assertJsonPath('data.0.archived_by.name', 'Acme Moderator')->assertJsonPath('data.0.starred', true);
        $this->getJson($this->url.'?archived=include')->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('meta.archived_count', 1);
        $this->getJson($this->url.'?archived=all')->assertUnprocessable()->assertJsonValidationErrors('archived');

        // It still opens, read-only: saves, restoring a version and access changes get 409.
        $this->getJson($path)->assertOk()->assertJsonPath('data.abilities', ['edit' => false, 'share' => false, 'delete' => true]);
        $this->putJson($path, [...$this->dashboard('Edited'), 'revision' => 1])->assertConflict()
            ->assertJsonPath('message', 'This dashboard is archived. Restore it before making changes.');
        $this->postJson($path.'/revisions/1/restore', ['revision' => 1])->assertConflict();
        $this->putJson($path.'/access', ['access' => 'restricted', 'shares' => []])->assertConflict();
        // A copy is a new, current dashboard.
        $this->postJson($path.'/duplicate', ['name' => 'Copy'])->assertOk()->assertJsonPath('data.archived_at', null);

        $this->postJson($path.'/restore')->assertOk()->assertJsonPath('data.archived_at', null)->assertJsonPath('data.archived_by', null);
        $this->assertSame($updated, DB::table('dashboards')->where('uuid', $created['uuid'])->value('updated_at'));
        $this->getJson($this->url)->assertOk()->assertJsonCount(3, 'data')->assertJsonPath('meta.archived_count', 0);
        $this->getJson($path)->assertOk()->assertJsonPath('data.abilities.edit', true)->assertJsonPath('data.starred', true)->assertJsonPath('data.revision', 1);
        $this->putJson($path, [...$this->dashboard('Edited'), 'revision' => 1])->assertOk()->assertJsonPath('data.name', 'Edited');
        $this->assertSame(['dashboard.archived', 'dashboard.unarchived'], DB::table('activity_log')->where('subject_uuid', $created['uuid'])->whereIn('event', ['dashboard.archived', 'dashboard.unarchived'])->orderBy('id')->pluck('event')->all());
    }

    public function test_the_owner_or_a_dashboard_manager_archives_and_restores(): void
    {
        $this->actAs('acme.moderator@example.test');
        $path = $this->url.'/'.$this->postJson($this->url, $this->dashboard())->assertOk()->json('data.uuid');

        // Members who may open it but don't own it can't archive it.
        $this->actAs('acme.member@example.test');
        $this->postJson($path.'/archive')->assertForbidden();

        // Dashboard.manage archives anyone's dashboard; the owner restores it.
        $this->actAs('shared.operator@example.test');
        $this->postJson($path.'/archive')->assertOk()->assertJsonPath('data.archived_by.name', 'Shared Operations Admin');
        $this->actAs('acme.member@example.test');
        $this->postJson($path.'/restore')->assertForbidden();
        $this->getJson($this->url)->assertOk()->assertJsonCount(0, 'data')->assertJsonPath('meta.archived_count', 1);
        $this->actAs('acme.moderator@example.test');
        $this->postJson($path.'/restore')->assertOk();

        // A restricted dashboard archived by its owner is neither listed nor counted for those it is closed to.
        $this->putJson($path.'/access', ['access' => 'restricted', 'shares' => []])->assertOk();
        $this->postJson($path.'/archive')->assertOk();
        $this->actAs('acme.member@example.test');
        $this->getJson($this->url.'?archived=include')->assertOk()->assertJsonCount(0, 'data')->assertJsonPath('meta.archived_count', 0);
    }

    public function test_another_organization_cannot_archive_or_restore(): void
    {
        $this->actAs('acme.moderator@example.test');
        $uuid = $this->postJson($this->url, $this->dashboard())->assertOk()->json('data.uuid');
        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();

        // Through its own organization the dashboard doesn't exist; through Acme's it is closed.
        $this->actAs('northstar.admin@example.test');
        $this->postJson('/api/v1/organizations/'.$northstar->uuid.'/dashboards/'.$uuid.'/archive')->assertNotFound();
        $this->postJson($this->url.'/'.$uuid.'/archive')->assertForbidden();
        $this->postJson($this->url.'/'.$uuid.'/restore')->assertForbidden();
        $this->assertNull(DB::table('dashboards')->where('uuid', $uuid)->value('archived_at'));
    }

    public function test_libraries_that_never_archive_are_unchanged(): void
    {
        $this->actAs('acme.moderator@example.test');
        $this->postJson($this->url, $this->dashboard('B'))->assertOk();
        $this->postJson($this->url, $this->dashboard('A'))->assertOk();

        $list = $this->getJson($this->url)->assertOk()->assertJsonPath('meta.archived_count', 0)->json('data');
        $this->assertSame(['A', 'B'], array_column($list, 'name'));
        $this->assertSame([null, null], array_column($list, 'archived_at'));
        $this->assertSame([['edit' => true, 'share' => true, 'delete' => true], ['edit' => true, 'share' => true, 'delete' => true]], array_column($list, 'abilities'));
    }

    private function actAs(string $email): void
    {
        $this->actingAs(User::where('email', $email)->firstOrFail(), 'sanctum');
    }

    private function dashboard(string $name = 'Line 2'): array
    {
        return ['name' => $name, 'widgets' => [], 'layouts' => [], 'defaults' => DashboardDefinition::defaults()];
    }
}
