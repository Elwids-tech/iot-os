<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Branding;

use App\Domain\Administration\Models\OrganizationInvitation;
use App\Domain\Administration\Notifications\OrganizationInvitationNotification;
use App\Domain\Administration\Notifications\OrganizationWelcomeNotification;
use App\Domain\Authentication\Notifications\PasswordResetNotification;
use App\Domain\Authentication\Notifications\SecurityChanged;
use App\Domain\Automation\Mail\AlertEmail;
use App\Domain\Automation\Models\Alert;
use App\Domain\Automation\Models\Deployment;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Billing\Mail\PaymentMail;
use App\Domain\Billing\Mail\UsageThresholdMail;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Branding\Models\Brand;
use App\Domain\Branding\Services\BrandImages;
use App\Domain\Branding\Services\Brands;
use App\Domain\Branding\Services\PortalAddresses;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use App\Domain\Support\Mail\TicketActivityMail;
use App\Domain\Support\Models\Ticket;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Mail\Markdown;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * What mail carries for an organization under a branded account, and that everyone
 * else's mail is what it was before brands existed (spec 036 US5, FR-028 to FR-030,
 * FR-034, SC-003).
 */
final class BrandedMailTest extends TestCase
{
    use BrandImageFixtures, PortalAddressFixtures, RefreshDatabase;

    private const PLATFORM_NAMES = ['IoT OS', 'ELWIDS', 'Laravel'];

    private Organization $acme;

    private Organization $northstar;

    private BillingAccount $account;

    private User $member;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        Storage::fake(BrandImages::DISK);
        Storage::fake('local');
        Queue::fake();
        $this->turnAddressesOn();
        config(['mail.from.address' => 'no-reply@example.com', 'mail.from.name' => 'IoT OS', 'app.name' => 'IoT OS']);
        $this->acme = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $this->member = User::where('email', 'acme.member@example.test')->firstOrFail();

        $this->account = $this->acme->billingAccount;
        $this->allow($this->account);
        Brand::query()->create(['billing_account_id' => $this->account->getKey(), 'product_name' => 'Acme Monitor', 'support_url' => 'https://support.example.org/help', 'revision' => 1]);
        app(PortalAddresses::class)->claimName($this->account, 'acme', null);
    }

    public function test_an_invitation_carries_the_brand_and_returns_to_the_main_address(): void
    {
        $mail = (new OrganizationInvitationNotification($this->invitation($this->acme), 'tok en'))->toMail((object) []);

        $this->assertSame('Join Acme Manufacturing on Acme Monitor', $mail->subject);
        $this->assertSame('You have been invited to Acme Monitor', $mail->greeting);
        $this->assertSame('https://acme.example.com/accept-invitation?token=tok+en', $mail->actionUrl);
        $this->assertBranded($mail);

        $plain = (new OrganizationInvitationNotification($this->invitation($this->northstar), 'tok en'))->toMail((object) []);
        $this->assertSame('Join Northstar Utilities on IoT OS', $plain->subject);
        $this->assertSame('You have been invited to IoT OS', $plain->greeting);
        $this->assertSame('https://app.example.com/accept-invitation?token=tok+en', $plain->actionUrl);
        $this->assertUnchanged($plain);
    }

    public function test_an_invitation_to_administer_the_platform_keeps_the_platforms_name(): void
    {
        $invitation = $this->invitation($this->acme);
        $invitation->grants_super_admin = true;
        $mail = (new OrganizationInvitationNotification($invitation, 'token'))->toMail((object) []);

        $this->assertSame('You have been invited to administer IoT OS', $mail->subject);
        $this->assertSame('https://app.example.com/accept-invitation?token=token', $mail->actionUrl);
        $this->assertUnchanged($mail);
    }

    public function test_the_welcome_carries_the_brand(): void
    {
        $mail = (new OrganizationWelcomeNotification($this->acme))->toMail($this->member);

        $this->assertSame('Welcome to Acme Manufacturing on Acme Monitor', $mail->subject);
        $this->assertSame('https://acme.example.com/organizations/'.$this->acme->uuid.'/home', $mail->actionUrl);
        $this->assertBranded($mail);

        $other = User::where('email', 'northstar.member@example.test')->firstOrFail();
        $plain = (new OrganizationWelcomeNotification($this->northstar))->toMail($other);
        $this->assertSame('Welcome to Northstar Utilities on IoT OS', $plain->subject);
        $this->assertSame('https://app.example.com/organizations/'.$this->northstar->uuid.'/home', $plain->actionUrl);
        $this->assertUnchanged($plain);
    }

    public function test_a_password_reset_follows_the_address_it_was_asked_for_at(): void
    {
        $notification = new PasswordResetNotification('token');
        $notification->origin = 'acme.example.com';
        $mail = $notification->toMail($this->member);

        $this->assertSame('Reset your Acme Monitor password', $mail->subject);
        $this->assertStringStartsWith('https://acme.example.com/reset-password#token=token&email=', $mail->actionUrl);
        $this->assertBranded($mail);

        // Asked for on the platform's address: as before, even for a branded account's member.
        $plain = (new PasswordResetNotification('token'))->toMail($this->member);
        $this->assertSame('Reset your ELWIDS password', $plain->subject);
        $this->assertStringStartsWith('https://app.example.com/reset-password#token=token&email=', $plain->actionUrl);
        $this->assertUnchanged($plain);
    }

    public function test_a_security_notice_follows_the_address_the_change_was_made_at(): void
    {
        $mail = (new SecurityChanged(SecurityChanged::PASSKEY_ADDED, ['name' => 'Laptop'], 'acme.example.com'))->toMail($this->member);

        $this->assertSame('https://acme.example.com/account/security', $mail->actionUrl);
        $this->assertBranded($mail);

        $plain = (new SecurityChanged(SecurityChanged::PASSKEY_ADDED, ['name' => 'Laptop']))->toMail($this->member);
        $this->assertSame('https://app.example.com/account/security', $plain->actionUrl);
        $this->assertUnchanged($plain);
    }

    public function test_the_header_shows_the_logo_when_the_brand_has_one(): void
    {
        $brand = app(Brands::class)->setImage($this->account, 'logo', $this->image(600, 200), null);
        $html = (string) (new OrganizationWelcomeNotification($this->acme))->toMail($this->member)->render();

        // A name under the platform's domain reads its images from the platform's API host.
        $this->assertStringContainsString('<img src="https://api.example.com/api/v1/brand-assets/'.$brand->logo->publicKey().'/logo" alt="Acme Monitor"', $html);
        $this->assertStringContainsString('<a href="https://acme.example.com"', $html);
    }

    public function test_an_alert_email_carries_the_brand(): void
    {
        $mail = new AlertEmail((string) Str::uuid(), $this->alert($this->acme), $this->acme, 'activated');

        $this->assertSame('Acme Monitor', $mail->envelope()->from?->name);
        $this->assertSame('no-reply@example.com', $mail->envelope()->from?->address);
        $text = $mail->render();
        $this->assertStringContainsString('Open this alert: https://acme.example.com/organizations/'.$this->acme->uuid.'/alerts/', $text);
        $this->assertStringContainsString('https://acme.example.com/organizations/'.$this->acme->uuid.'/settings/notifications', $text);
        $this->assertNoPlatformName($text.$mail->envelope()->subject);

        $plain = new AlertEmail((string) Str::uuid(), $this->alert($this->northstar), $this->northstar, 'activated');
        $this->assertNull($plain->envelope()->from);
        $this->assertStringContainsString('Open this alert: https://app.example.com/organizations/'.$this->northstar->uuid.'/alerts/', $plain->render());
    }

    public function test_a_ticket_email_carries_the_brand_for_its_people_and_not_for_the_platforms_team(): void
    {
        $ticket = $this->ticket($this->acme, 'acme.member@example.test');

        $mail = new TicketActivityMail($ticket, 'participant_added', false, null, null, 1);
        $this->assertSame('Acme Monitor', $mail->envelope()->from?->name);
        $this->assertStringContainsString('Open the ticket: https://acme.example.com/organizations/'.$this->acme->uuid.'/support/'.$ticket->uuid, $mail->render());
        $this->assertNoPlatformName($mail->render());

        $team = new TicketActivityMail($ticket, 'filed', true, null, null, 2);
        $this->assertNull($team->envelope()->from);
        $this->assertStringContainsString(rtrim((string) config('app.admin_url'), '/').'/tickets/'.$ticket->uuid, $team->render());

        $other = $this->ticket($this->northstar, 'northstar.member@example.test');
        $plain = new TicketActivityMail($other, 'participant_added', false, null, null, 3);
        $this->assertNull($plain->envelope()->from);
        $this->assertStringContainsString('Open the ticket: https://app.example.com/organizations/'.$this->northstar->uuid.'/support/'.$other->uuid, $plain->render());
    }

    public function test_a_brand_whose_allowance_was_withdrawn_is_not_used(): void
    {
        $this->allow($this->account, value: 0);
        $mail = (new OrganizationWelcomeNotification($this->acme))->toMail($this->member);

        $this->assertSame('Welcome to Acme Manufacturing on IoT OS', $mail->subject);
        $this->assertSame('https://app.example.com/organizations/'.$this->acme->uuid.'/home', $mail->actionUrl);
        $this->assertUnchanged($mail);
    }

    public function test_invoices_and_payment_mail_keep_the_operators_name(): void
    {
        foreach ([
            new UsageThresholdMail($this->account->uuid, 'Acme Billing', 'sms', '2026-11-01', 80, 4, 5),
        ] as $mail) {
            $this->assertNull($mail->envelope()->from);
            $text = $mail->render();
            $this->assertStringNotContainsString('Acme Monitor', $text);
            $this->assertStringContainsString('https://app.example.com/billing?account='.$this->account->uuid, $text);
        }
        // The payment mail's link, without building an invoice.
        $this->assertStringContainsString("app(PortalLinks::class)->platform('billing')", (string) file_get_contents((new \ReflectionClass(PaymentMail::class))->getFileName()));
    }

    /** The brand's sender name on the platform's sending address, the brand in the header and footer, and no platform name anywhere. */
    private function assertBranded(MailMessage $mail): void
    {
        // Tracked and shipped: git and the image build ignore every folder named vendor.
        $this->assertFileExists(resource_path('views/mail/notification.blade.php'));
        $this->assertStringNotContainsString('/vendor/', (string) config('mail.markdown.paths.0'));
        $this->assertSame(['no-reply@example.com', 'Acme Monitor'], $mail->from);
        $html = (string) $mail->render();
        $text = (string) app(Markdown::class)->renderText($mail->markdown, $mail->data());
        foreach ([$html, $text] as $body) {
            $this->assertStringContainsString('Acme Monitor', $body);
            $this->assertStringContainsString('https://support.example.org/help', $body);
            $this->assertNoPlatformName($body);
            $this->assertStringNotContainsString('app.example.com', $body);
        }
        $this->assertNoPlatformName((string) $mail->subject.$mail->greeting);
    }

    private function assertNoPlatformName(string $text): void
    {
        foreach (self::PLATFORM_NAMES as $name) {
            $this->assertStringNotContainsStringIgnoringCase($name, $text);
        }
    }

    /**
     * No sender of its own, and the same bytes Laravel's own templates give: the
     * published ones change nothing for a mail without a brand.
     */
    private function assertUnchanged(MailMessage $mail): void
    {
        $this->assertSame([], $mail->from);
        $this->assertArrayNotHasKey('brand', $mail->viewData);
        $this->assertSame('notifications::email', $mail->markdown);

        view()->addNamespace('stock-notifications', base_path('vendor/laravel/framework/src/Illuminate/Notifications/resources/views'));
        $stock = new Markdown(view(), ['theme' => 'default', 'paths' => []]);
        $ours = app(Markdown::class);
        $this->assertSame(
            (string) $stock->render('stock-notifications::email', $mail->data()),
            (string) $ours->render($mail->markdown, $mail->data()),
        );
        $this->assertSame(
            (string) $stock->renderText('stock-notifications::email', $mail->data()),
            (string) $ours->renderText($mail->markdown, $mail->data()),
        );
    }

    private function invitation(Organization $organization): OrganizationInvitation
    {
        return (new OrganizationInvitation)->forceFill(['email' => 'new.person@example.test', 'expires_at' => now()->addDays(7)])->setRelation('organization', $organization);
    }

    private function alert(Organization $organization): Alert
    {
        $actor = User::where('email', 'super-admin@example.test')->firstOrFail();
        $definition = ['binding' => ['device_uuid' => (string) Str::uuid()]];
        $workflow = Workflow::create(['organization_id' => $organization->id, 'name' => 'North paddock', 'workflow' => ['nodes' => []], 'definition' => $definition, 'definition_hash' => str_repeat('a', 64), 'updated_by' => $actor->id]);
        $deployment = Deployment::create(['automation_workflow_id' => $workflow->id, 'generation' => 1, 'draft_revision' => 1, 'target' => 'active', 'status' => 'succeeded', 'definition' => $definition, 'definition_hash' => str_repeat('a', 64), 'created_by' => $actor->id, 'created_at' => now()]);
        $workflow->update(['applied_deployment_uuid' => $deployment->uuid, 'desired_deployment_uuid' => $deployment->uuid, 'deployment_status' => 'applied']);
        config(['devices.runtime_token' => str_repeat('t', 40)]);
        $this->withToken(str_repeat('t', 40))->postJson('/api/internal/devices/events', ['uuid' => (string) Str::uuid(), 'type' => 'workflow.transition.v1', 'payload' => [
            'rule_uuid' => $workflow->uuid, 'organization_uuid' => $organization->uuid, 'operation_uuid' => $deployment->uuid,
            'transition' => ['id' => hash('sha256', $deployment->uuid.':1:activated'), 'type' => 'activated', 'episode' => 1, 'occurred_at' => now()->toIso8601String(), 'rule_uuid' => $workflow->uuid, 'organization_uuid' => $organization->uuid, 'device_uuid' => $definition['binding']['device_uuid'], 'version_uuid' => $deployment->uuid, 'definition_hash' => $deployment->definition_hash],
        ]])->assertOk();

        return Alert::query()->where('organization_id', $organization->id)->latest('id')->firstOrFail();
    }

    private function ticket(Organization $organization, string $email): Ticket
    {
        $this->actingAs(User::where('email', $email)->firstOrFail(), 'sanctum');
        $uuid = $this->withHeaders(['Accept' => 'application/json'])->post('/api/v1/organizations/'.$organization->uuid.'/tickets', [
            'client_id' => (string) Str::uuid(), 'type' => 'bug', 'title' => 'Devices page shows no readings', 'body' => 'Expected readings, saw none.',
            'context' => ['path' => '/organizations/x/devices', 'user_agent' => 'Mozilla/5.0 Test', 'screen' => '1440x900', 'time_zone' => 'Asia/Colombo'],
        ])->assertCreated()->json('data.uuid');

        return Ticket::query()->where('uuid', $uuid)->firstOrFail();
    }
}
