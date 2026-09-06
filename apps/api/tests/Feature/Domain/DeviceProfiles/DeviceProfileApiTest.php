<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\DeviceProfiles;

use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Spatie\Permission\PermissionRegistrar;
use Tests\TestCase;

final class DeviceProfileApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_an_organization_administrator_can_author_and_publish_a_profile_using_only_public_uuids(): void
    {
        $this->seed(DatabaseSeeder::class);
        $organization = Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail();
        $administrator = User::query()->where('email', 'shared.operator@example.test')->firstOrFail();
        app(PermissionRegistrar::class)->setPermissionsTeamId($organization->getKey());
        $this->assertTrue($administrator->fresh()->hasPermissionTo('DeviceProfile.create'));
        $prefix = "/api/v1/organizations/{$organization->uuid}/device-profiles";

        $profile = $this->actingAs($administrator, 'sanctum')
            ->postJson($prefix, ['code' => 'api-rgb-light', 'name' => 'API RGB Light', 'category' => 'lighting'])
            ->assertCreated()
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonMissingPath('data.id')
            ->json('data');

        $parameter = $this->actingAs($administrator, 'sanctum')
            ->postJson("{$prefix}/{$profile['uuid']}/parameters", [
                'key' => 'brightness',
                'label' => 'Brightness',
                'kind' => 'state',
                'data_type' => 'integer',
                'unit' => '%',
                'reports_state' => true,
                'accepts_command' => true,
                'validation_logic' => [
                    'engine' => 'json_logic',
                    'rule' => ['and' => [
                        ['>=' => [['var' => 'value'], 1]],
                        ['<=' => [['var' => 'value'], 10]],
                    ]],
                    'diagnostic_code' => 'brightness_out_of_range',
                    'message' => 'Brightness must be between 1 and 10.',
                ],
                'draft_revision' => $profile['draft_revision'],
            ])
            ->assertCreated()
            ->assertJsonPath('data.key', 'brightness')
            ->assertJsonMissingPath('data.id')
            ->json('data');

        $current = DeviceProfile::query()->where('uuid', $profile['uuid'])->firstOrFail();
        $this->actingAs($administrator, 'sanctum')
            ->postJson("{$prefix}/{$profile['uuid']}/validate")
            ->assertOk()
            ->assertJsonPath('data.valid', true);
        $this->actingAs($administrator, 'sanctum')
            ->postJson("{$prefix}/{$profile['uuid']}/publish", ['draft_revision' => $current->draft_revision])
            ->assertCreated()
            ->assertJsonPath('data.revision', 1)
            ->assertJsonPath('data.definition.parameters.0.uuid', $parameter['uuid'])
            ->assertJsonMissingPath('data.definition.parameters.0.id');
    }

    public function test_profile_routes_hide_another_organization_profile_and_reject_a_stale_draft_revision(): void
    {
        $this->seed(DatabaseSeeder::class);
        $acme = Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail();
        $northstar = Organization::query()->where('slug', 'northstar-utilities')->firstOrFail();
        $administrator = User::query()->where('email', 'shared.operator@example.test')->firstOrFail();
        app(PermissionRegistrar::class)->setPermissionsTeamId($acme->getKey());
        $this->assertTrue($administrator->fresh()->hasPermissionTo('DeviceProfile.update'));
        $profile = DeviceProfile::query()->create([
            'organization_id' => $acme->getKey(),
            'code' => 'acme-only',
            'name' => 'Acme only',
        ]);

        $this->actingAs($administrator, 'sanctum')
            ->getJson("/api/v1/organizations/{$northstar->uuid}/device-profiles/{$profile->uuid}")
            ->assertNotFound();

        $this->actingAs($administrator, 'sanctum')
            ->patchJson("/api/v1/organizations/{$acme->uuid}/device-profiles/{$profile->uuid}", [
                'name' => 'First edit',
                'draft_revision' => 1,
            ])
            ->assertOk();
        $this->actingAs($administrator, 'sanctum')
            ->patchJson("/api/v1/organizations/{$acme->uuid}/device-profiles/{$profile->uuid}", [
                'name' => 'Conflicting edit',
                'draft_revision' => 1,
            ])
            ->assertConflict()
            ->assertJsonPath('code', 'profile.draft_conflict');
    }
}
