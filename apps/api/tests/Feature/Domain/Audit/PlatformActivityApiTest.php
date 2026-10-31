<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Audit;

use App\Domain\Audit\Models\Activity;
use App\Domain\Audit\Services\ActivityChanges;
use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Devices\Models\Site;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

final class PlatformActivityApiTest extends TestCase
{
    use RefreshDatabase;

    private const URL = '/api/v1/admin/activity';

    private Organization $acme;

    private Organization $northstar;

    private User $administrator;

    private User $ana;

    private User $ben;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(DatabaseSeeder::class);
        // Seeding records its own events; these tests start from an empty log.
        Activity::query()->delete();
        $this->acme = Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail();
        $this->northstar = Organization::query()->where('slug', 'northstar-utilities')->firstOrFail();
        $this->administrator = User::query()->where('email', 'platform-admin@example.test')->firstOrFail();
        $this->ana = User::query()->where('email', 'acme.member@example.test')->firstOrFail();
        $this->ben = User::query()->where('email', 'northstar.member@example.test')->firstOrFail();
    }

    public function test_platform_administrators_see_what_people_did_newest_first(): void
    {
        $site = Site::query()->create(['organization_id' => $this->acme->id, 'name' => 'Yard', 'timezone' => 'UTC']);
        ActivityLog::record('site.updated', $this->acme, $this->ana, $site, [], ActivityChanges::between(['name' => 'Old yard', 'tags' => ['a']], ['name' => 'Yard', 'tags' => ['a', 'b']]));
        ActivityLog::record('alert.raised', $this->acme, null, (string) Str::uuid());
        ActivityLog::record('dashboard.updated', $this->acme, $this->ana, (string) Str::uuid(), ['changed' => ['layouts']]);
        $site->update(['name' => 'North yard']);

        $response = $this->actingAs($this->administrator, 'sanctum')->getJson(self::URL)->assertOk();

        $response->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.action', 'dashboard.updated')
            ->assertJsonPath('data.0.summary', 'updated dashboard')
            ->assertJsonPath('data.0.subject.type', 'dashboard')
            ->assertJsonPath('data.0.subject.name', null)
            ->assertJsonPath('data.0.changes', [['field' => 'layouts', 'from' => null, 'to' => null, 'opaque' => true]])
            ->assertJsonPath('data.1.action', 'site.updated')
            ->assertJsonPath('data.1.actor', ['id' => $this->ana->id, 'name' => $this->ana->name, 'email' => $this->ana->email])
            ->assertJsonPath('data.1.organization', ['uuid' => $this->acme->uuid, 'name' => $this->acme->name])
            ->assertJsonPath('data.1.subject', ['type' => 'site', 'uuid' => $site->uuid, 'name' => 'North yard'])
            ->assertJsonPath('data.1.changes', [
                ['field' => 'name', 'from' => 'Old yard', 'to' => 'Yard', 'opaque' => false],
                ['field' => 'tags', 'from' => ['a'], 'to' => ['a', 'b'], 'opaque' => false],
            ])
            ->assertJsonPath('meta.next_cursor', null)
            ->assertJsonPath('meta.per_page', 50);
    }

    public function test_only_administrators_who_manage_organizations_may_read_it(): void
    {
        $this->getJson(self::URL)->assertUnauthorized();
        $this->actingAs($this->ana, 'sanctum')->getJson(self::URL)->assertForbidden();
        $this->actingAs(User::query()->where('email', 'shared.operator@example.test')->firstOrFail(), 'sanctum')->getJson(self::URL)->assertForbidden();
    }

    public function test_it_filters_by_person_and_by_organization(): void
    {
        ActivityLog::record('device.updated', $this->acme, $this->ana, (string) Str::uuid());
        ActivityLog::record('device.updated', $this->northstar, $this->ana, (string) Str::uuid());
        ActivityLog::record('device.updated', $this->northstar, $this->ben, (string) Str::uuid());
        ActivityLog::record('billing_account.updated', null, $this->ana, (string) Str::uuid());
        $this->actingAs($this->administrator, 'sanctum');

        $this->assertSame([$this->northstar->uuid, $this->northstar->uuid], $this->getJson(self::URL.'?organization='.$this->northstar->uuid)->assertOk()->json('data.*.organization.uuid'));
        $this->assertSame(['billing_account.updated', 'device.updated', 'device.updated'], $this->getJson(self::URL.'?user_id='.$this->ana->id)->assertOk()->json('data.*.action'));
        $both = $this->getJson(self::URL.'?user_id='.$this->ana->id.'&organization='.$this->acme->uuid)->assertOk();
        $both->assertJsonCount(1, 'data')->assertJsonPath('data.0.organization.uuid', $this->acme->uuid)->assertJsonPath('data.0.actor.id', $this->ana->id);
        // Another organization's events never answer an organization filter.
        $this->assertNotContains($this->northstar->uuid, $both->json('data.*.organization.uuid'));
    }

    public function test_it_pages_older_events_with_a_cursor(): void
    {
        foreach (range(1, 55) as $number) {
            ActivityLog::record('site.created', $this->acme, $this->ana, null, ['number' => $number]);
        }
        $this->actingAs($this->administrator, 'sanctum');

        $first = $this->getJson(self::URL)->assertOk()->assertJsonCount(50, 'data');
        $this->assertSame([['key' => 'number', 'value' => '55']], $first->json('data.0.details'));
        $cursor = $first->json('meta.next_cursor');
        $this->assertIsString($cursor);

        $second = $this->getJson(self::URL.'?cursor='.urlencode($cursor))->assertOk()->assertJsonCount(5, 'data')->assertJsonPath('meta.next_cursor', null);
        $this->assertSame(['5', '4', '3', '2', '1'], $second->json('data.*.details.0.value'));
    }

    public function test_a_deleted_person_keeps_their_events(): void
    {
        $leaver = User::factory()->create(['name' => 'Leaver']);
        ActivityLog::record('device.updated', $this->acme, $leaver, null);
        $id = $leaver->id;
        $leaver->delete();

        $this->actingAs($this->administrator, 'sanctum')->getJson(self::URL)
            ->assertOk()
            ->assertJsonPath('data.0.actor', ['id' => $id, 'name' => null, 'email' => null]);
    }

    public function test_a_deleted_subject_keeps_the_name_it_had(): void
    {
        $site = Site::query()->create(['organization_id' => $this->acme->id, 'name' => 'Old shed', 'timezone' => 'UTC']);
        ActivityLog::record('site.deleted', $this->acme, $this->ana, $site, ['name' => 'Old shed', 'user_id' => 3, 'user_name' => 'Ben', 'site_uuid' => $site->uuid]);
        $site->forceDelete();

        $this->actingAs($this->administrator, 'sanctum')->getJson(self::URL)
            ->assertOk()
            ->assertJsonPath('data.0.summary', 'deleted site')
            ->assertJsonPath('data.0.subject.name', 'Old shed')
            // Ids, UUIDs and a repeat of the subject's name are left out of the details.
            ->assertJsonPath('data.0.details', [['key' => 'user_name', 'value' => 'Ben']]);
    }

    public function test_unknown_filters_are_rejected(): void
    {
        $this->actingAs($this->administrator, 'sanctum');

        $this->getJson(self::URL.'?user_id=999999')->assertUnprocessable()->assertJsonValidationErrors('user_id');
        $this->getJson(self::URL.'?organization='.Str::uuid())->assertUnprocessable()->assertJsonValidationErrors('organization');

        // A malformed value never reaches the query, where PostgreSQL would answer 500.
        DB::enableQueryLog();
        $this->getJson(self::URL.'?organization=not-a-uuid&user_id=abc')->assertUnprocessable()->assertJsonValidationErrors(['organization', 'user_id']);
        $this->assertSame([], array_filter(DB::getQueryLog(), fn (array $query): bool => str_contains($query['query'], 'organizations') || str_contains($query['query'], 'from "users" where "id"')));
    }
}
