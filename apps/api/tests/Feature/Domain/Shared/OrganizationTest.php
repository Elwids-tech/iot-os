<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Shared;

use App\Domain\Shared\Models\Organization;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class OrganizationTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_assigns_a_public_uuid_and_uses_it_for_route_binding(): void
    {
        $organization = Organization::factory()->create([
            'name' => 'Acme Manufacturing',
            'slug' => 'acme-manufacturing',
        ]);

        $this->assertTrue(Str::isUuid($organization->uuid));
        $this->assertSame('uuid', $organization->getRouteKeyName());
        $this->assertDatabaseHas('organizations', [
            'id' => $organization->id,
            'uuid' => $organization->uuid,
            'name' => 'Acme Manufacturing',
            'slug' => 'acme-manufacturing',
        ]);
    }

    public function test_organization_slugs_are_unique(): void
    {
        Organization::factory()->create(['slug' => 'acme-manufacturing']);

        $this->expectException(QueryException::class);

        Organization::factory()->create(['slug' => 'acme-manufacturing']);
    }

    public function test_it_can_be_soft_deleted(): void
    {
        $organization = Organization::factory()->create();

        $organization->delete();

        $this->assertSoftDeleted($organization);
    }
}
