<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Geospatial;

use App\Domain\Geospatial\Models\LocationBinding;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\GpsUseCaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class LocationBindingTest extends TestCase
{
    use RefreshDatabase;

    private LocationBinding $binding;

    private string $url;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->seed(GpsUseCaseSeeder::class);
        $organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->binding = LocationBinding::whereHas('device', fn ($query) => $query->where('uuid', GpsUseCaseSeeder::DEVICE_UUID))->firstOrFail();
        $this->url = '/api/v1/organizations/'.$organization->uuid.'/location-bindings/'.GpsUseCaseSeeder::DEVICE_UUID;
        $this->actingAs(User::where('is_super_admin', true)->firstOrFail(), 'sanctum');
    }

    public function test_leaving_out_the_optional_accuracy_parameter_saves_the_binding_without_accuracy(): void
    {
        $this->assertNotNull($this->binding->accuracy_parameter_uuid);

        $this->putJson($this->url, $this->input())->assertOk()
            ->assertJsonPath('data.revision', 2)
            ->assertJsonPath('data.accuracy_parameter_uuid', null)
            ->assertJsonPath('data.latitude_parameter_uuid', $this->binding->latitude_parameter_uuid)
            ->assertJsonPath('data.max_age_seconds', 120);
        $this->assertNull($this->binding->fresh()->accuracy_parameter_uuid);
    }

    public function test_a_stale_revision_conflicts_and_keeps_the_saved_binding(): void
    {
        $this->putJson($this->url, [...$this->input(), 'revision' => 0])->assertStatus(409)
            ->assertJsonPath('message', 'The location binding changed. Reload before saving.');
        $this->assertSame(1, $this->binding->fresh()->revision);
    }

    public function test_every_location_parameter_must_belong_to_the_applied_profile(): void
    {
        $this->putJson($this->url, [...$this->input(), 'accuracy_parameter_uuid' => '30000000-0000-4000-8000-999999999999'])
            ->assertStatus(422)->assertJsonPath('message', 'Every location parameter must belong to the applied profile.');
    }

    /** A complete request without the optional accuracy key. */
    private function input(): array
    {
        return ['revision' => $this->binding->revision, 'configuration_uuid' => GpsUseCaseSeeder::CONFIGURATION_UUID,
            'latitude_parameter_uuid' => $this->binding->latitude_parameter_uuid, 'longitude_parameter_uuid' => $this->binding->longitude_parameter_uuid,
            'max_age_seconds' => 120, 'max_future_skew_seconds' => 5, 'allow_unknown_accuracy' => true];
    }
}
