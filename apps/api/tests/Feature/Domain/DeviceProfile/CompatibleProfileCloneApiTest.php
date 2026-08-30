<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\DeviceProfile;

use App\Domain\DeviceProfile\Enums\DefinitionState;
use App\Domain\DeviceProfile\Models\DeviceProfile;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use JsonException;
use Tests\TestCase;

final class CompatibleProfileCloneApiTest extends TestCase
{
    use RefreshDatabase;

    /** @throws JsonException */
    public function test_an_administrator_can_clone_a_published_profile_as_a_compatible_draft(): void
    {
        $this->seed(DatabaseSeeder::class);

        $organization = Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail();
        $administrator = User::query()->where('email', 'shared.operator@example.test')->firstOrFail();
        $payload = json_decode(
            file_get_contents(base_path('../../contracts/fixtures/device-onboarding/valid/three-phase-meter/profile.json')),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );
        $headers = ['X-Organization-UUID' => $organization->uuid];

        $created = $this->actingAs($administrator, 'sanctum')->postJson(
            '/api/v1/device-profiles',
            $payload,
            [...$headers, 'Idempotency-Key' => 'compatible-clone-source'],
        )->assertCreated();

        $profileUuid = $created->json('data.profile.uuid');
        $sourceVersionUuid = $created->json('data.version.uuid');
        $sourceParameterUuids = collect($created->json('data.version.parameters'))->pluck('uuid')->all();

        $this->actingAs($administrator, 'sanctum')->postJson(
            "/api/v1/device-profiles/{$profileUuid}/compatible-clone",
            [],
            [...$headers, 'Idempotency-Key' => 'compatible-clone-reject-draft'],
        )->assertConflict();

        $profile = DeviceProfile::query()->where('uuid', $profileUuid)->firstOrFail();
        $source = $profile->versions()->firstOrFail();
        $source->forceFill([
            'state' => DefinitionState::PUBLISHED,
            'published_at' => now(),
        ])->save();

        $cloned = $this->actingAs($administrator, 'sanctum')->postJson(
            "/api/v1/device-profiles/{$profileUuid}/compatible-clone",
            [],
            [...$headers, 'Idempotency-Key' => 'compatible-clone-create'],
        )->assertCreated()
            ->assertJsonPath('data.profile.uuid', $profileUuid)
            ->assertJsonPath('data.version.version', 2)
            ->assertJsonPath('data.meta.state', 'draft');

        $this->assertNotSame($sourceVersionUuid, $cloned->json('data.version.uuid'));
        $this->assertSame(
            $sourceParameterUuids,
            collect($cloned->json('data.version.parameters'))->pluck('uuid')->all(),
        );
    }
}
