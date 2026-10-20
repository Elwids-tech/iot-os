<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Administration;

use App\Domain\Administration\Models\OrganizationInvitation;
use App\Domain\Administration\Notifications\OrganizationWelcomeNotification;
use App\Domain\Authorization\Enums\OrganizationRoleName;
use App\Domain\Authorization\Models\Role;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Tests\TestCase;

final class OrganizationWelcomeEmailTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $administrator;

    protected function setUp(): void
    {
        parent::setUp();

        Notification::fake();
        $this->seed(DatabaseSeeder::class);
        $this->organization = Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail();
        $this->administrator = User::query()->where('email', 'shared.operator@example.test')->firstOrFail();
    }

    public function test_a_new_member_is_welcomed_through_the_alerts_queue_after_accepting(): void
    {
        $token = $this->invite('new.member@example.test', OrganizationRoleName::MEMBER);

        $this->postJson("/api/v1/invitations/{$token}/accept", [
            'name' => 'New Member',
            'password' => 'safe-password',
            'password_confirmation' => 'safe-password',
        ])->assertOk();

        $member = User::query()->where('email', 'new.member@example.test')->firstOrFail();
        Notification::assertSentTo($member, OrganizationWelcomeNotification::class, function (OrganizationWelcomeNotification $notification) use ($member): bool {
            $mail = $notification->toMail($member);

            return $notification->connection === 'alerts'
                && $notification->queue === 'alerts'
                && $notification->afterCommit === true
                && $mail->subject === 'Welcome to Acme Manufacturing on IoT OS'
                && $mail->actionUrl === rtrim((string) config('app.frontend_url'), '/')."/organizations/{$this->organization->uuid}/home";
        });
    }

    public function test_an_existing_account_is_welcomed_when_it_joins_another_organization(): void
    {
        $person = User::factory()->create(['email' => 'existing.person@example.test']);
        $token = $this->invite($person->email, OrganizationRoleName::MEMBER);

        $this->actingAs($person)->postJson("/api/v1/invitations/{$token}/accept")->assertOk();

        Notification::assertSentTo($person, OrganizationWelcomeNotification::class);
    }

    public function test_the_welcome_describes_only_what_the_role_allows(): void
    {
        $member = $this->welcome('member@example.test', OrganizationRoleName::MEMBER);
        $this->assertStringContainsString('Follow your devices', $member);
        $this->assertStringContainsString('Open dashboards', $member);
        $this->assertStringContainsString('Keep an eye on alerts', $member);
        $this->assertStringContainsString('Get help', $member);
        foreach (['Build dashboards', 'Respond to alerts', 'Control devices', 'Connect devices', 'Automate', 'Invite your team'] as $section) {
            $this->assertStringNotContainsString($section, $member);
        }

        $administrator = $this->welcome('admin@example.test', OrganizationRoleName::ORGANIZATION_ADMIN);
        foreach (['Follow your devices', 'Build dashboards', 'Respond to alerts', 'Control devices', 'Connect devices', 'Automate', 'Invite your team', 'Get help'] as $section) {
            $this->assertStringContainsString($section, $administrator);
        }
        $this->assertStringNotContainsString('Open dashboards', $administrator);
        $this->assertStringNotContainsString('Keep an eye on alerts', $administrator);
    }

    public function test_someone_removed_before_the_email_is_sent_is_not_welcomed(): void
    {
        $token = $this->invite('short.stay@example.test', OrganizationRoleName::MEMBER);
        $this->postJson("/api/v1/invitations/{$token}/accept", [
            'name' => 'Short Stay',
            'password' => 'safe-password',
            'password_confirmation' => 'safe-password',
        ])->assertOk();

        $member = User::query()->where('email', 'short.stay@example.test')->firstOrFail();
        $notification = new OrganizationWelcomeNotification($this->organization);
        $this->assertTrue($notification->shouldSend($member, 'mail'));

        $member->organizations()->detach($this->organization->id);

        $this->assertFalse($notification->shouldSend($member, 'mail'));
    }

    public function test_super_administrator_invitations_send_no_welcome(): void
    {
        $token = Str::random(64);
        OrganizationInvitation::query()->create([
            'uuid' => (string) Str::uuid(),
            'organization_id' => null,
            'grants_super_admin' => true,
            'email' => 'new.admin@example.test',
            'role_ids' => [],
            'token_hash' => hash('sha256', $token),
            'invited_by_user_id' => User::query()->where('email', 'super-admin@example.test')->value('id'),
            'expires_at' => now()->addDays(7),
        ]);

        $this->postJson("/api/v1/invitations/{$token}/accept", [
            'name' => 'New Admin',
            'password' => 'safe-password',
            'password_confirmation' => 'safe-password',
        ])->assertOk();

        Notification::assertNotSentTo(User::query()->where('email', 'new.admin@example.test')->firstOrFail(), OrganizationWelcomeNotification::class);
    }

    private function invite(string $email, OrganizationRoleName $role): string
    {
        $token = Str::random(64);
        OrganizationInvitation::query()->create([
            'uuid' => (string) Str::uuid(),
            'organization_id' => $this->organization->id,
            'email' => $email,
            'role_ids' => [Role::query()->where('organization_id', $this->organization->id)->where('name', $role->value)->value('id')],
            'token_hash' => hash('sha256', $token),
            'invited_by_user_id' => $this->administrator->id,
            'expires_at' => now()->addDays(7),
        ]);

        return $token;
    }

    /**
     * Accept an invitation with one role and return the welcome email's text.
     */
    private function welcome(string $email, OrganizationRoleName $role): string
    {
        $token = $this->invite($email, $role);
        // Accepting signs the person in; the next invitation is for someone new.
        $this->flushSession();
        $this->app['auth']->forgetGuards();
        $this->postJson("/api/v1/invitations/{$token}/accept", [
            'name' => 'Invited Person',
            'password' => 'safe-password',
            'password_confirmation' => 'safe-password',
        ])->assertOk();

        $person = User::query()->where('email', $email)->firstOrFail();
        $mail = null;
        Notification::assertSentTo($person, OrganizationWelcomeNotification::class, function (OrganizationWelcomeNotification $notification) use ($person, &$mail): bool {
            $mail = $notification->toMail($person);

            return true;
        });

        $this->assertInstanceOf(MailMessage::class, $mail);

        return implode("\n", [...$mail->introLines, ...$mail->outroLines]);
    }
}
