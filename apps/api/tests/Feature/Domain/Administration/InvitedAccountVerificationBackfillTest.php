<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Administration;

use App\Domain\Administration\Models\OrganizationInvitation;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Tests\TestCase;

final class InvitedAccountVerificationBackfillTest extends TestCase
{
    use RefreshDatabase;

    public function test_unverified_accounts_with_an_accepted_invitation_are_verified_as_of_their_first_acceptance(): void
    {
        $organization = Organization::factory()->create();
        $joined = User::factory()->unverified()->create(['email' => 'joined@example.test']);
        $pending = User::factory()->unverified()->create(['email' => 'pending@example.test']);
        $verified = User::factory()->create(['email' => 'verified@example.test', 'email_verified_at' => '2026-10-01 08:00:00']);

        $this->invitation($organization, $joined->email, '2026-10-05 09:30:00');
        $this->invitation($organization, $joined->email, '2026-10-20 12:00:00');
        $this->invitation($organization, $pending->email, null);
        $this->invitation($organization, $verified->email, '2026-10-06 10:00:00');

        $migration = require database_path('migrations/2026_10_23_000000_verify_accounts_that_accepted_invitations.php');
        $migration->up();
        $migration->up();

        $this->assertSame('2026-10-05 09:30:00', $joined->fresh()->email_verified_at?->toDateTimeString());
        $this->assertNull($pending->fresh()->email_verified_at);
        $this->assertSame('2026-10-01 08:00:00', $verified->fresh()->email_verified_at?->toDateTimeString());
    }

    private function invitation(Organization $organization, string $email, ?string $acceptedAt): void
    {
        OrganizationInvitation::query()->create([
            'uuid' => (string) Str::uuid(),
            'organization_id' => $organization->id,
            'email' => $email,
            'role_ids' => [],
            'token_hash' => hash('sha256', Str::random(64)),
            'expires_at' => Carbon::parse('2026-10-30 00:00:00'),
            'accepted_at' => $acceptedAt === null ? null : Carbon::parse($acceptedAt),
        ]);
    }
}
