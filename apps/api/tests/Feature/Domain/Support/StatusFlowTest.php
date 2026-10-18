<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Support;

/** Spec 015 US3 and FR-005: how replies and the reporter move the status. */
final class StatusFlowTest extends SupportTestCase
{
    public function test_a_reply_answers_a_request_for_information(): void
    {
        $ticket = $this->file();
        $this->teamReply($ticket['uuid'], 'Which meter?', ['status' => 'needs_info', 'revision' => 1])->assertCreated();

        $answered = $this->reply('acme.member@example.test', $ticket['uuid'], 'Serial 4411.')->assertCreated()->json('data');

        $this->assertSame('in_review', $answered['status']);
        $change = collect($this->events($answered, 'status'))->last();
        $this->assertSame(['needs_info', 'in_review', 'reply'], [$change['from'], $change['to'], $change['cause']]);
        $this->assertSame('Acme Member', $change['actor']['name']);
        $this->actAs('super-admin@example.test');
        $this->getJson($this->admin($ticket['uuid']))->assertOk()->assertJsonPath('data.awaiting_team', true)->assertJsonPath('data.revision', 3);
    }

    public function test_a_reply_reopens_a_resolved_ticket_but_not_a_declined_one(): void
    {
        $resolved = $this->file();
        $this->teamReply($resolved['uuid'], 'Fixed in the last release.', ['status' => 'resolved', 'revision' => 1])->assertCreated()
            ->assertJsonPath('data.status', 'resolved');

        $reopened = $this->reply('acme.member@example.test', $resolved['uuid'], 'Still broken for me.')->assertCreated()->json('data');
        $this->assertSame('in_review', $reopened['status']);
        $this->assertNull($reopened['closed_at']);

        $declined = $this->file(overrides: ['title' => 'Make everything purple', 'type' => 'feature_request']);
        $this->teamReply($declined['uuid'], 'Not something we will do.', ['status' => 'declined', 'revision' => 1])->assertCreated();
        $this->actAs('acme.member@example.test');
        $seen = $this->getJson($this->ticket($declined['uuid']))->assertOk()->json('data');
        $this->assertFalse($seen['abilities']['reply']);
        $this->assertNotNull($seen['closed_at']);
        $this->reply('acme.member@example.test', $declined['uuid'], 'Please?')->assertUnprocessable()->assertJsonValidationErrors('body');
        // The team can still write on it.
        $this->teamReply($declined['uuid'], 'Closing the loop.')->assertCreated();
    }

    public function test_the_reporter_closes_and_renames_their_own_ticket(): void
    {
        $ticket = $this->file();
        $this->tag('acme.member@example.test', $ticket['uuid'], 'acme.moderator@example.test')->assertOk();

        $this->actAs('acme.moderator@example.test');
        $this->patchJson($this->ticket($ticket['uuid']), ['status' => 'resolved'])->assertForbidden();
        $this->patchJson($this->ticket($ticket['uuid']), ['title' => 'Mine now'])->assertForbidden();

        $this->actAs('acme.member@example.test');
        $this->patchJson($this->ticket($ticket['uuid']), ['status' => 'in_progress'])->assertUnprocessable();
        $renamed = $this->patchJson($this->ticket($ticket['uuid']), ['title' => 'Pump meter shows no readings'])->assertOk()->json('data');
        $this->assertSame(['Devices page shows no readings', 'Pump meter shows no readings'], [$this->events($renamed, 'title')[0]['from'], $this->events($renamed, 'title')[0]['to']]);

        $closed = $this->patchJson($this->ticket($ticket['uuid']), ['status' => 'resolved'])->assertOk()->json('data');
        $this->assertSame('resolved', $closed['status']);
        $this->assertFalse($closed['abilities']['close']);
        $this->assertSame('Acme Member', collect($this->events($closed, 'status'))->last()['actor']['name']);
        $this->patchJson($this->ticket($ticket['uuid']), ['status' => 'resolved'])->assertUnprocessable()->assertJsonValidationErrors('status');
    }

    public function test_reading_up_to_a_sequence_keeps_later_activity_unread(): void
    {
        $ticket = $this->file();
        $this->teamReply($ticket['uuid'], 'First answer.')->assertCreated();
        $this->actAs('acme.member@example.test');
        $shown = $this->getJson($this->ticket($ticket['uuid']))->assertOk()->json('data.sequence');
        $this->teamReply($ticket['uuid'], 'Second answer, while the page was open.')->assertCreated();

        $this->actAs('acme.member@example.test');
        $this->postJson($this->ticket($ticket['uuid']).'/read', ['sequence' => $shown])->assertNoContent();
        $this->getJson($this->tickets().'/summary')->assertOk()->assertJsonPath('data.unread', 1);
        $this->postJson($this->ticket($ticket['uuid']).'/read')->assertNoContent();
        $this->getJson($this->tickets().'/summary')->assertOk()->assertJsonPath('data.unread', 0);
    }
}
