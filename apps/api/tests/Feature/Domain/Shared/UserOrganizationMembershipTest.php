<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Shared;

use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class UserOrganizationMembershipTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_user_can_belong_to_multiple_organizations(): void
    {
        $user = User::factory()->create();
        $firstOrganization = Organization::factory()->create();
        $secondOrganization = Organization::factory()->create();

        $user->organizations()->attach([
            $firstOrganization->id,
            $secondOrganization->id,
        ]);

        $this->assertCount(2, $user->fresh()->organizations);
        $this->assertTrue($firstOrganization->fresh()->users->contains($user));
        $this->assertTrue($secondOrganization->fresh()->users->contains($user));
        $this->assertDatabaseHas('organization_user', [
            'organization_id' => $firstOrganization->id,
            'user_id' => $user->id,
        ]);
    }

    public function test_a_user_cannot_be_added_to_the_same_organization_twice(): void
    {
        $user = User::factory()->create();
        $organization = Organization::factory()->create();

        $user->organizations()->attach($organization);

        $this->expectException(QueryException::class);

        $user->organizations()->attach($organization);
    }
}
