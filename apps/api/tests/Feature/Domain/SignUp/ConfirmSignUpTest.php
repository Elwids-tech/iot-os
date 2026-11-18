<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\SignUp;

use App\Domain\Audit\Models\Activity;
use App\Domain\Authorization\Enums\OrganizationRoleName;
use App\Domain\Authorization\Models\Role;
use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\Allowances;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use App\Domain\SignUp\Events\SignUpCompleted;
use App\Domain\SignUp\Models\SignUp;
use App\Domain\SignUp\Notifications\SignUpWelcome;
use App\Domain\SignUp\Services\SignUps;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

/** Opening the link (spec 035 US1, FR-010 to FR-012, FR-017, FR-018, research R3 to R5). */
final class ConfirmSignUpTest extends TestCase
{
    use RefreshDatabase, SignsUp;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSignUp();
    }

    public function test_the_link_creates_the_person_their_billing_account_and_organization_and_signs_in_this_browser(): void
    {
        Event::fake([SignUpCompleted::class]);
        $this->submit()->assertStatus(202);

        $response = $this->confirm($this->linkToken())->assertOk();

        $user = User::query()->where('email', 'jane@example.com')->sole();
        $this->assertSame('Jane Doe', $user->name);
        $this->assertFalse((bool) $user->is_super_admin);
        $this->assertNotNull($user->email_verified_at);
        $this->assertTrue(Hash::check(self::PASSWORD, $user->password));

        $organization = Organization::query()->sole();
        $this->assertSame('Acme Water', $organization->name);
        $this->assertSame('acme-water', $organization->slug);
        $this->assertFalse((bool) $organization->two_step_required);
        $response->assertExactJson([
            'state' => 'completed',
            'signed_in' => true,
            'organization_uuid' => $organization->uuid,
            'email' => 'jane@example.com',
        ]);

        $account = BillingAccount::query()->sole();
        $this->assertSame($account->getKey(), $organization->billing_account_id);
        $this->assertSame('Acme Water', $account->name);
        $this->assertSame('jane@example.com', $account->contact_email);
        $this->assertTrue($account->owners()->whereKey($user->getKey())->exists());
        $this->assertNull($account->openPlanAssignment()->first());
        $this->assertSame(1, app(Allowances::class)->value($account, AllowanceKind::Organizations));

        $this->assertTrue($user->organizations()->whereKey($organization->getKey())->exists());
        $role = Role::query()->where('organization_id', $organization->id)->where('name', OrganizationRoleName::ORGANIZATION_ADMIN->value)->firstOrFail();
        $this->assertTrue(DB::table(config('permission.table_names.model_has_roles'))->where('role_id', $role->id)->where('model_id', $user->id)->exists());

        $signUp = SignUp::query()->sole();
        $this->assertSame('completed', $signUp->state);
        $this->assertNull($signUp->password);
        $this->assertSame($user->getKey(), $signUp->user_id);
        $this->assertSame($organization->getKey(), $signUp->organization_id);
        $this->assertSame($account->getKey(), $signUp->billing_account_id);
        $this->assertNotNull($signUp->signed_in_at);

        // The same activity an administrator and an owner leave, with the person as actor.
        foreach (['billing_account.created', 'billing_account.owner_added', 'organization.created', 'sign_up.completed'] as $action) {
            $entry = Activity::query()->where('event', $action)->sole();
            $this->assertSame($user->getKey(), $entry->causer_id === null ? null : (int) $entry->causer_id, $action);
        }
        $this->assertSame('sign_up', Activity::query()->where('event', 'organization.created')->sole()->properties['source']);

        Notification::assertSentTo($user, SignUpWelcome::class);
        Event::assertDispatched(SignUpCompleted::class, fn (SignUpCompleted $event) => $event->signUpId === $signUp->getKey());

        $this->assertAuthenticatedAs($user, 'web');
        $this->portal()->getJson('/api/v1/me')->assertOk()
            ->assertJsonPath('data.id', $user->getKey())
            ->assertJsonPath('data.organizations.0.uuid', $organization->uuid);
    }

    public function test_another_browser_confirms_without_being_signed_in(): void
    {
        $this->submit()->assertStatus(202);
        $token = $this->linkToken();

        $this->anotherBrowser();
        $this->confirm($token)->assertOk()->assertJson(['state' => 'completed', 'signed_in' => false, 'email' => 'jane@example.com']);

        $this->assertGuest('web');
        $this->portal()->getJson('/api/v1/me')->assertUnauthorized();
        $this->assertNull(SignUp::query()->sole()->signed_in_at);
    }

    public function test_a_used_link_says_so_and_creates_nothing_more(): void
    {
        $this->submit()->assertStatus(202);
        $token = $this->linkToken();
        $this->confirm($token)->assertOk();

        $this->confirm($token)->assertStatus(410)->assertJson(['code' => 'used', 'email' => 'jane@example.com']);
        $this->anotherBrowser();
        $this->confirm($token)->assertStatus(410)->assertJson(['code' => 'used']);

        $this->assertSame(1, Organization::query()->count());
        $this->assertSame(1, BillingAccount::query()->count());
    }

    public function test_an_expired_link_says_so(): void
    {
        $this->submit()->assertStatus(202);
        $token = $this->linkToken();

        $this->travel(24)->hours();
        $this->travel(1)->minutes();
        $this->confirm($token)->assertStatus(410)->assertJson(['code' => 'expired', 'email' => 'jane@example.com']);
        $this->confirm('not-a-token')->assertNotFound();
        $this->assertSame(0, Organization::query()->count());
    }

    public function test_an_account_created_for_the_address_meanwhile_refuses_the_sign_up(): void
    {
        $this->submit()->assertStatus(202);
        $token = $this->linkToken();
        User::factory()->create(['email' => 'jane@example.com']);

        $this->confirm($token)->assertStatus(409)->assertJson(['code' => 'account_exists', 'email' => 'jane@example.com']);
        $this->confirm($token)->assertStatus(409);

        $signUp = SignUp::query()->sole();
        $this->assertSame('refused', $signUp->state);
        $this->assertSame('account_exists', $signUp->refusal_reason);
        $this->assertNull($signUp->password);
        $this->assertSame(0, Organization::query()->count());
        $this->portal()->getJson('/api/v1/sign-up/status')->assertOk()
            ->assertExactJson(['state' => 'refused', 'reason' => 'account_exists', 'email' => 'jane@example.com']);
    }

    public function test_a_link_still_completes_after_sign_up_closes(): void
    {
        $this->submit()->assertStatus(202);
        DB::table('sign_up_settings')->update(['open' => false]);

        $this->confirm($this->linkToken())->assertOk()->assertJsonPath('state', 'completed');
        $this->assertSame(1, Organization::query()->count());
    }

    public function test_a_taken_organization_address_gets_a_number(): void
    {
        Organization::factory()->create(['name' => 'Acme Water', 'slug' => 'acme-water']);
        $this->submit()->assertStatus(202);

        $this->confirm($this->linkToken())->assertOk();

        $this->assertSame('acme-water-2', Organization::query()->latest('id')->firstOrFail()->slug);
    }

    public function test_the_session_key_is_dropped_once_signed_in(): void
    {
        $this->submit()->assertStatus(202);
        $this->confirm($this->linkToken())->assertOk()->assertJsonPath('signed_in', true);

        $this->assertNull(session(SignUps::SESSION_KEY));
    }
}
