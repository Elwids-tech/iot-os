<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Support;

use App\Domain\Support\Jobs\DeliverTicketEmail;
use App\Domain\Support\Mail\TicketActivityMail;
use App\Domain\Support\Services\TicketAccess;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

/** Spec 015 US5: who is emailed about what, once. */
final class EmailTest extends SupportTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
    }

    public function test_a_new_ticket_emails_the_team(): void
    {
        $ticket = $this->file(overrides: ['body' => 'The pump meter page is empty & has been since Monday.']);

        $this->assertSame(['super-admin@example.test'], $this->deliver());
        Mail::assertSent(TicketActivityMail::class, function (TicketActivityMail $mail) use ($ticket): bool {
            $text = $mail->render();

            return $mail->hasTo('super-admin@example.test')
                && $mail->envelope()->subject === "[#{$ticket['number']}] Devices page shows no readings"
                && str_contains($text, 'Acme Member filed a new bug in Acme Manufacturing:')
                && str_contains($text, 'empty & has been since Monday')
                && str_contains($text, 'http://localhost:5174/tickets/'.$ticket['uuid']);
        });
        Queue::assertPushedOn('alerts', DeliverTicketEmail::class);
    }

    public function test_a_team_reply_with_a_status_is_one_email_to_each_person(): void
    {
        $ticket = $this->file();
        $this->tag('acme.member@example.test', $ticket['uuid'], 'acme.moderator@example.test')->assertOk();
        $this->deliver();
        Mail::fake();

        $this->teamReply($ticket['uuid'], 'Which meter serial?', ['status' => 'needs_info', 'revision' => 1])->assertCreated();
        $this->teamReply($ticket['uuid'], 'Internal: likely firmware 2.1.', ['internal' => '1'])->assertCreated();

        $this->assertSame(['acme.member@example.test', 'acme.moderator@example.test'], $this->deliver());
        Mail::assertSent(TicketActivityMail::class, 2);
        Mail::assertSent(TicketActivityMail::class, function (TicketActivityMail $mail) use ($ticket): bool {
            $text = $mail->render();

            return str_contains($text, 'Platform Super Admin replied:') && str_contains($text, 'Which meter serial?')
                && str_contains($text, 'Changed the status from New to Needs information.')
                && str_contains($text, 'http://localhost:5173/organizations/'.$this->acme->uuid.'/support/'.$ticket['uuid'])
                && ! str_contains($text, 'firmware');
        });
    }

    public function test_a_status_change_alone_emails_the_people(): void
    {
        $ticket = $this->file();
        $this->deliver();
        Mail::fake();
        $this->actAs('super-admin@example.test');

        $this->patchJson($this->admin($ticket['uuid']), ['revision' => 1, 'status' => 'planned', 'priority' => 'high'])->assertOk();

        $this->assertSame(['acme.member@example.test'], $this->deliver());
        Mail::assertSent(TicketActivityMail::class, fn (TicketActivityMail $mail): bool => str_contains($mail->render(), 'Platform Super Admin changed the status from New to Planned.')
            && ! str_contains($mail->render(), 'High'));
    }

    public function test_a_person_reply_goes_to_the_assignee_and_the_other_people(): void
    {
        $ticket = $this->file();
        $this->tag('acme.member@example.test', $ticket['uuid'], 'acme.moderator@example.test')->assertOk();
        $this->deliver();

        $this->reply('acme.moderator@example.test', $ticket['uuid'], 'Seeing it too.')->assertCreated();
        $this->assertSame(['acme.member@example.test', 'super-admin@example.test'], $this->deliver());

        // Once assigned, only the assignee hears from people on the team side.
        $second = $this->user('platform-admin@example.test');
        $second->forceFill(['is_super_admin' => true])->save();
        $this->actAs('super-admin@example.test');
        $this->patchJson($this->admin($ticket['uuid']), ['revision' => 1, 'assignee_id' => $second->id])->assertOk();
        $this->deliver();
        $this->reply('acme.member@example.test', $ticket['uuid'], 'Any news?')->assertCreated();
        $this->assertSame(['acme.moderator@example.test', 'platform-admin@example.test'], $this->deliver());
    }

    public function test_tagging_someone_emails_them(): void
    {
        $ticket = $this->file();
        $this->deliver();

        $this->tag('acme.member@example.test', $ticket['uuid'], 'acme.moderator@example.test')->assertOk();

        $this->assertSame(['acme.moderator@example.test'], $this->deliver());
        Mail::assertSent(TicketActivityMail::class, fn (TicketActivityMail $mail): bool => str_contains($mail->render(), 'Acme Member added you to this ticket.'));
    }

    public function test_preferences_and_lost_access_cancel_the_email(): void
    {
        $ticket = $this->file();
        $this->tag('acme.member@example.test', $ticket['uuid'], 'acme.moderator@example.test')->assertOk();
        $this->deliver();
        Mail::fake();

        $this->actAs('acme.member@example.test');
        $preferences = $this->getJson('/api/v1/notifications/preferences')->assertOk()->assertJsonPath('data.ticket_email', true)->json('data');
        $this->putJson('/api/v1/notifications/preferences', [...array_intersect_key($preferences, array_flip(['revision', 'email_enabled', 'grid'])), 'ticket_email' => false])
            ->assertOk()->assertJsonPath('data.ticket_email', false);
        $this->teamReply($ticket['uuid'], 'An update.')->assertCreated();
        $this->acme->users()->detach($this->user('acme.moderator@example.test')->id);

        $this->assertSame([], $this->deliver());
        $this->assertSame(['cancelled', 'cancelled'], DB::table('support_ticket_email_deliveries')->where('kind', 'reply')->orderBy('user_id')->pluck('status')->all());
        Mail::assertNothingSent();
    }

    public function test_a_retried_action_sends_nothing_twice(): void
    {
        $ticket = $this->file();
        $this->deliver();
        $this->actAs('acme.member@example.test');
        $form = ['client_id' => (string) Str::uuid(), 'body' => 'Once only.'];

        $this->send($this->ticket($ticket['uuid']).'/messages', $form)->assertCreated();
        $this->send($this->ticket($ticket['uuid']).'/messages', $form)->assertCreated();
        $this->send($this->ticket($ticket['uuid']).'/messages', [...$form, 'body' => 'Different.'])->assertConflict();

        $this->assertSame(['super-admin@example.test'], $this->deliver());
        $this->assertSame(1, DB::table('support_ticket_messages')->where('client_id', $form['client_id'])->count());
        foreach (DB::table('support_ticket_email_deliveries')->pluck('id') as $id) {
            (new DeliverTicketEmail((int) $id))->handle(app(TicketAccess::class));
        }
        Mail::assertSent(TicketActivityMail::class, 2);
    }

    /**
     * Runs the pending deliveries as the alerts worker would.
     *
     * @return list<string> the addresses that got an email, sorted
     */
    private function deliver(): array
    {
        $ids = DB::table('support_ticket_email_deliveries')->where('status', 'pending')->pluck('id');
        foreach ($ids as $id) {
            (new DeliverTicketEmail((int) $id))->handle(app(TicketAccess::class));
        }

        return DB::table('support_ticket_email_deliveries')->join('users', 'users.id', '=', 'support_ticket_email_deliveries.user_id')
            ->whereIn('support_ticket_email_deliveries.id', $ids)->where('status', 'sent')
            ->orderBy('users.email')->pluck('users.email')->all();
    }
}
