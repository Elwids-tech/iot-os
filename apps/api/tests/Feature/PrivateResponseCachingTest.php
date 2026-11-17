<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** A signed-in person's API responses never stay in the browser's cache (spec 033, SC-005). */
final class PrivateResponseCachingTest extends TestCase
{
    use RefreshDatabase;

    public function test_signed_in_responses_are_not_stored_unless_they_chose_a_lifetime(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum');

        $me = $this->getJson('/api/v1/me')->assertOk();
        $this->assertTrue($me->headers->hasCacheControlDirective('no-store'));
        $this->assertTrue($me->headers->hasCacheControlDirective('private'));

        // The unit catalogue is the same for everyone and keeps its hour.
        $units = $this->getJson('/api/v1/units')->assertOk();
        $this->assertSame('3600', $units->headers->getCacheControlDirective('max-age'));
        $this->assertFalse($units->headers->hasCacheControlDirective('no-store'));
    }

    public function test_signed_out_responses_keep_the_framework_default(): void
    {
        $this->assertFalse($this->getJson('/api/v1/me')->assertUnauthorized()->headers->hasCacheControlDirective('no-store'));
    }
}
