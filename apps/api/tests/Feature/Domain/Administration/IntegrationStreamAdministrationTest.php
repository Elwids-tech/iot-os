<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Administration;

use App\Domain\Integrations\Models\IntegrationApplication;
use App\Domain\Integrations\Models\IntegrationStreamSession;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/** Platform administrators see an organization's open telemetry streams (spec 030, US6); nobody else does. */
final class IntegrationStreamAdministrationTest extends TestCase
{
    use RefreshDatabase;

    public function test_platform_administrators_list_open_streams_with_their_application_and_position(): void
    {
        $this->seed(DatabaseSeeder::class);
        $acme = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $twin = IntegrationApplication::create(['organization_id' => $acme->id, 'name' => 'Twin Studio', 'abilities' => ['telemetry:read', 'telemetry:stream'], 'device_uuids' => [(string) Str::uuid()]]);
        $foreign = IntegrationApplication::create(['organization_id' => $northstar->id, 'name' => 'Foreign', 'abilities' => ['telemetry:read'], 'device_uuids' => [(string) Str::uuid()]]);
        $session = fn (IntegrationApplication $application, array $attributes = []) => IntegrationStreamSession::create(['integration_application_id' => $application->id, 'organization_id' => $application->organization_id,
            'opened_at' => now()->subMinutes(10), 'last_seen_at' => now()->subSeconds(5), 'device_count' => 3, ...$attributes]);
        $older = $session($twin, ['opened_at' => now()->subMinutes(20), 'last_position' => '9031']);
        $newer = $session($twin, ['device_count' => 1]);
        $session($twin, ['closed_at' => now(), 'close_reason' => 'lifetime']);
        $session($twin, ['last_seen_at' => now()->subMinutes(3)]);
        $session($foreign);

        // Nobody signed in first: the guard is the first refusal, before any actor is set.
        $this->getJson("/api/v1/admin/organizations/{$acme->uuid}/integration-streams")->assertUnauthorized();

        $administrator = User::where('email', 'platform-admin@example.test')->firstOrFail();
        $response = $this->actingAs($administrator, 'sanctum')
            ->getJson("/api/v1/admin/organizations/{$acme->uuid}/integration-streams")
            ->assertOk()->assertJsonCount(2, 'data');
        $this->assertSame([$older->id, $newer->id], $response->json('data.*.id'), 'oldest first');
        $this->assertSame(['uuid' => $twin->uuid, 'name' => 'Twin Studio'], $response->json('data.0.application'));
        $this->assertSame('9031', $response->json('data.0.last_position'));
        $this->assertNull($response->json('data.1.last_position'));
        $this->assertSame(1, $response->json('data.1.device_count'));
        $this->assertSame($older->fresh()->opened_at->toJSON(), $response->json('data.0.opened_at'));
        $this->assertNotNull($response->json('data.0.last_seen_at'));

        $this->actingAs(User::where('email', 'acme.member@example.test')->firstOrFail(), 'sanctum')
            ->getJson("/api/v1/admin/organizations/{$acme->uuid}/integration-streams")
            ->assertForbidden();
        $this->actingAs($administrator, 'sanctum')
            ->getJson('/api/v1/admin/organizations/'.Str::uuid().'/integration-streams')
            ->assertNotFound();
    }
}
