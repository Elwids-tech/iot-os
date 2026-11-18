<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Administration;

use App\Domain\Audit\Models\Activity;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Tests\Support\TwoStepFixtures;
use Tests\TestCase;

/** An organization requires two-step sign-in for its members (spec 034, US3, FR-021). */
final class OrganizationTwoStepTest extends TestCase
{
    use RefreshDatabase, TwoStepFixtures;

    private Organization $acme;

    private Organization $northstar;

    private User $administrator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->withoutMiddleware(ValidateCsrfToken::class);
        Notification::fake();
        $this->acme = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        // Administrator of Acme, moderator of Northstar.
        $this->administrator = $this->person('shared.operator@example.test');
    }

    public function test_an_administrator_with_two_step_requires_it_and_the_change_is_recorded(): void
    {
        $this->turnOnTwoStep($this->administrator);

        $this->as($this->administrator)->getJson($this->url($this->acme))->assertOk()
            ->assertJsonPath('data.two_step_required', false)
            ->assertJsonPath('data.can_change', true)
            ->assertJsonPath('data.members_without_two_step', $this->acme->users()->count() - 1);

        $this->as($this->administrator)->putJson($this->url($this->acme), ['two_step_required' => true])->assertOk()
            ->assertJsonPath('data.two_step_required', true);
        $this->assertTrue($this->acme->refresh()->two_step_required);

        $entry = Activity::where('event', 'organization.two_step_required_changed')->sole();
        $this->assertSame($this->acme->id, $entry->organization_id);
        $this->assertSame($this->administrator->id, (int) $entry->causer_id);
        $this->assertTrue($entry->properties['required']);
        $this->assertEquals(['attributes' => ['two_step_required' => true], 'old' => ['two_step_required' => false]], $entry->attribute_changes->toArray());

        // Saving the same value again records nothing.
        $this->as($this->administrator)->putJson($this->url($this->acme), ['two_step_required' => true])->assertOk();
        $this->assertSame(1, Activity::where('event', 'organization.two_step_required_changed')->count());

        // The organization context and the member list carry it.
        $this->as($this->administrator)->getJson("/api/v1/organizations/{$this->acme->uuid}/context")->assertOk()->assertJsonPath('data.two_step_required', true);
        $members = collect($this->as($this->administrator)->getJson("/api/v1/organizations/{$this->acme->uuid}/members")->assertOk()->json('data'))->keyBy('email');
        $this->assertTrue($members['shared.operator@example.test']['two_step_enabled']);
        $this->assertFalse($members['acme.member@example.test']['two_step_enabled']);
        $this->assertArrayNotHasKey('two_factor_secret', $members['acme.member@example.test']);
    }

    public function test_an_administrator_without_two_step_is_asked_to_set_up_their_own_first(): void
    {
        $this->as($this->administrator)->getJson($this->url($this->acme))->assertOk()->assertJsonPath('data.can_change', false);

        $this->as($this->administrator)->putJson($this->url($this->acme), ['two_step_required' => true])
            ->assertConflict()
            ->assertJsonPath('code', 'two_step_setup_required');
        $this->assertFalse($this->acme->refresh()->two_step_required);
        $this->assertSame(0, Activity::where('event', 'organization.two_step_required_changed')->count());
    }

    public function test_the_setting_needs_organization_update(): void
    {
        $member = $this->person('acme.member@example.test');
        $this->turnOnTwoStep($member);

        $this->as($member)->getJson($this->url($this->acme))->assertForbidden();
        $this->as($member)->putJson($this->url($this->acme), ['two_step_required' => true])->assertForbidden();
        // A moderator of Northstar may not change it there either.
        $this->turnOnTwoStep($this->administrator);
        $this->as($this->administrator)->putJson($this->url($this->northstar), ['two_step_required' => true])->assertForbidden();
        $this->as($this->administrator)->putJson($this->url($this->acme), ['two_step_required' => 'sometimes'])->assertUnprocessable()->assertJsonValidationErrors('two_step_required');
    }

    public function test_a_member_of_another_organization_does_not_find_it(): void
    {
        $outsider = $this->person('northstar.admin@example.test');
        $this->turnOnTwoStep($outsider);

        $this->as($outsider)->getJson($this->url($this->acme))->assertNotFound();
        $this->as($outsider)->putJson($this->url($this->acme), ['two_step_required' => true])->assertNotFound();
        $this->assertFalse($this->acme->refresh()->two_step_required);
    }

    public function test_turning_it_off_lets_members_turn_their_own_off_again_but_does_not_do_it_for_them(): void
    {
        $this->turnOnTwoStep($this->administrator);
        $member = $this->person('acme.member@example.test');
        $this->turnOnTwoStep($member);
        $this->as($this->administrator)->putJson($this->url($this->acme), ['two_step_required' => true])->assertOk();
        $this->as($this->administrator)->putJson($this->url($this->acme), ['two_step_required' => false])->assertOk()->assertJsonPath('data.two_step_required', false);

        $this->assertTrue($member->refresh()->hasEnabledTwoFactorAuthentication());
        $this->assertSame(2, Activity::where('event', 'organization.two_step_required_changed')->count());
    }

    private function url(Organization $organization): string
    {
        return "/api/v1/organizations/{$organization->uuid}/security";
    }

    private function person(string $email): User
    {
        return User::where('email', $email)->firstOrFail();
    }

    private ?int $signedIn = null;

    /** Signed in as the person, in a fresh session when the previous request was someone else's. */
    private function as(User $user): static
    {
        if ($this->signedIn !== null && $this->signedIn !== $user->id) {
            $this->flushSession();
            $this->app['auth']->forgetGuards();
        }
        $this->signedIn = $user->id;

        return $this->withHeader('Origin', 'http://localhost')->actingAs($user, 'web');
    }
}
