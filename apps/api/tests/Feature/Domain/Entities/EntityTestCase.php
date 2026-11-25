<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Entities;

use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

abstract class EntityTestCase extends TestCase
{
    use RefreshDatabase;

    protected Organization $organization;

    protected string $prefix;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actAs('shared.operator@example.test');
        $this->prefix = '/api/v1/organizations/'.$this->organization->uuid;
    }

    protected function actAs(string $email): void
    {
        $this->actingAs(User::where('email', $email)->firstOrFail(), 'sanctum');
    }

    /**
     * @param  array<string, mixed>  $values
     * @return array<string, mixed>
     */
    protected function entity(string $type, string $name, ?string $parent = null, array $values = []): array
    {
        return $this->postJson($this->prefix.'/entities', ['type_key' => $type, 'name' => $name, 'parent_uuid' => $parent, ...$values])
            ->assertCreated()->json('data');
    }

    protected function preset(string $key): TestResponse
    {
        return $this->postJson($this->prefix.'/entity-presets/'.$key.'/apply')->assertOk();
    }
}
