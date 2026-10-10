<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Shared;

use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class OrganizationFeaturesTest extends TestCase
{
    use RefreshDatabase;

    public function test_organization_payload_reports_whether_device_adapters_are_enabled(): void
    {
        $this->seed(DatabaseSeeder::class);
        $organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actingAs(User::where('email', 'shared.operator@example.test')->firstOrFail());
        $context = '/api/v1/organizations/'.$organization->uuid.'/context';

        config(['adapters.enabled' => false]);
        $this->getJson($context)->assertOk()->assertJsonPath('data.capabilities.features.device_adapters', false);
        $this->getJson('/api/v1/organizations/'.$organization->uuid.'/device-adapters')->assertNotFound();

        config(['adapters.enabled' => true]);
        $this->getJson($context)->assertOk()->assertJsonPath('data.capabilities.features.device_adapters', true);
        $organizations = $this->getJson('/api/v1/me')->assertOk()->json('data.organizations');
        $this->assertNotEmpty($organizations);
        $this->assertSame([true], array_values(array_unique(array_column(array_column(array_column($organizations, 'capabilities'), 'features'), 'device_adapters'))));
    }
}
