<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\DeviceProfiles;

use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceConfiguration;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Spatie\Permission\PermissionRegistrar;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

final class ArchiveDeviceProfileTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $administrator;

    private string $prefix;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->organization = Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail();
        $this->administrator = User::query()->where('email', 'shared.operator@example.test')->firstOrFail();
        app(PermissionRegistrar::class)->setPermissionsTeamId($this->organization->getKey());
        $this->prefix = "/api/v1/organizations/{$this->organization->uuid}/device-profiles";
    }

    public function test_an_unused_published_profile_is_archived_locked_and_restored_as_it_was(): void
    {
        [$profile] = $this->publishedProfile();

        $this->actingAs($this->administrator, 'sanctum')
            ->postJson("{$this->prefix}/{$profile->uuid}/archive", ['draft_revision' => $profile->draft_revision])
            ->assertOk()
            ->assertJsonPath('data.status', 'archived')
            ->assertJsonPath('data.revision', 1);
        $this->assertDatabaseHas('activity_log', ['event' => 'device_profile.archived', 'subject_id' => $profile->id]);

        $this->actingAs($this->administrator, 'sanctum')
            ->getJson("{$this->prefix}?status=archived")
            ->assertOk()
            ->assertJsonPath('data.0.uuid', $profile->uuid);
        $listed = $this->actingAs($this->administrator, 'sanctum')->getJson($this->prefix)->assertOk()->json('data.*.uuid');
        $this->assertNotContains($profile->uuid, $listed, 'Without a status filter, archived profiles stay out of pickers.');
        $archived = $profile->fresh();
        $this->actingAs($this->administrator, 'sanctum')
            ->patchJson("{$this->prefix}/{$profile->uuid}", ['name' => 'Renamed', 'draft_revision' => $archived->draft_revision])
            ->assertUnprocessable();
        $this->actingAs($this->administrator, 'sanctum')
            ->postJson("{$this->prefix}/{$profile->uuid}/archive", ['draft_revision' => $archived->draft_revision])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'This profile is already archived.');

        $this->actingAs($this->administrator, 'sanctum')
            ->postJson("{$this->prefix}/{$profile->uuid}/restore", ['draft_revision' => $archived->draft_revision])
            ->assertOk()
            ->assertJsonPath('data.status', 'published');
        $this->assertDatabaseHas('activity_log', ['event' => 'device_profile.restored', 'subject_id' => $profile->id]);
    }

    public function test_a_never_published_draft_is_restored_as_a_draft(): void
    {
        $profile = DeviceProfile::query()->create(['organization_id' => $this->organization->id, 'code' => 'never-published', 'name' => 'Never published']);

        $this->actingAs($this->administrator, 'sanctum')
            ->postJson("{$this->prefix}/{$profile->uuid}/archive", ['draft_revision' => 1])
            ->assertOk()
            ->assertJsonPath('data.status', 'archived');
        $this->actingAs($this->administrator, 'sanctum')
            ->postJson("{$this->prefix}/{$profile->uuid}/restore", ['draft_revision' => 2])
            ->assertOk()
            ->assertJsonPath('data.status', 'draft');
    }

    public function test_a_profile_used_by_a_device_is_refused_until_the_device_is_archived(): void
    {
        [$profile, $artifact] = $this->publishedProfile();
        $device = Device::query()->create(['organization_id' => $this->organization->id, 'code' => 'tracker-1', 'name' => 'Tracker 1', 'lifecycle' => 'active']);
        DeviceConfiguration::query()->create(['device_id' => $device->id, 'device_profile_artifact_id' => $artifact->id, 'revision' => 1,
            'definition_hash' => $artifact->definition_hash, 'definition' => ['mappings' => []], 'created_at' => now()]);

        $this->actingAs($this->administrator, 'sanctum')
            ->postJson("{$this->prefix}/{$profile->uuid}/archive", ['draft_revision' => $profile->draft_revision])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'This profile is still used by 1 device.');

        $device->update(['lifecycle' => 'archived']);
        $this->actingAs($this->administrator, 'sanctum')
            ->postJson("{$this->prefix}/{$profile->uuid}/archive", ['draft_revision' => $profile->draft_revision])
            ->assertOk();
    }

    public function test_a_device_draft_on_the_profile_counts_as_a_use(): void
    {
        [$profile, $artifact] = $this->publishedProfile();
        Device::query()->create(['organization_id' => $this->organization->id, 'code' => 'tracker-2', 'name' => 'Tracker 2', 'lifecycle' => 'active',
            'draft' => ['artifact_uuid' => $artifact->uuid]]);

        $this->actingAs($this->administrator, 'sanctum')
            ->postJson("{$this->prefix}/{$profile->uuid}/archive", ['draft_revision' => $profile->draft_revision])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'This profile is still used by 1 device.');
    }

    public function test_unpublished_changes_are_refused(): void
    {
        [$profile] = $this->publishedProfile();
        $profile->forceFill(['status' => 'draft'])->save();

        $this->actingAs($this->administrator, 'sanctum')
            ->postJson("{$this->prefix}/{$profile->uuid}/archive", ['draft_revision' => $profile->draft_revision])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Publish or undo the unpublished changes before archiving this profile.');
    }

    public function test_a_stale_revision_conflicts_and_only_an_archived_profile_is_restored(): void
    {
        [$profile] = $this->publishedProfile();

        $this->actingAs($this->administrator, 'sanctum')
            ->postJson("{$this->prefix}/{$profile->uuid}/archive", ['draft_revision' => $profile->draft_revision + 1])
            ->assertConflict()
            ->assertJsonPath('code', 'profile.draft_conflict');
        $this->actingAs($this->administrator, 'sanctum')
            ->postJson("{$this->prefix}/{$profile->uuid}/restore", ['draft_revision' => $profile->draft_revision + 1])
            ->assertConflict();
        $this->actingAs($this->administrator, 'sanctum')
            ->postJson("{$this->prefix}/{$profile->uuid}/restore", ['draft_revision' => $profile->draft_revision])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'This profile is not archived.');
    }

    public function test_a_version_of_an_archived_profile_is_refused_for_new_use(): void
    {
        [$profile, $artifact] = $this->publishedProfile();
        $profile->forceFill(['status' => 'archived'])->save();

        $this->expectException(HttpException::class);
        $this->expectExceptionMessage('This profile is archived. Restore it before using it.');
        $artifact->fresh()->ensureNotArchived();
    }

    /** @return array{DeviceProfile, DeviceProfileArtifact} */
    private function publishedProfile(): array
    {
        $profile = DeviceProfile::query()->create(['organization_id' => $this->organization->id, 'code' => 'old-tracker', 'name' => 'Old tracker']);
        $profile->forceFill(['status' => 'published', 'revision' => 1, 'published_at' => now()])->save();
        $artifact = DeviceProfileArtifact::query()->create(['device_profile_id' => $profile->id, 'revision' => 1, 'definition' => [],
            'definition_hash' => str_repeat('a', 64), 'status' => 'active', 'compiled_at' => now()]);

        return [$profile->fresh(), $artifact];
    }
}
