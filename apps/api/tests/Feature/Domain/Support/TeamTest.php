<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Support;

use App\Domain\Support\Models\Ticket;
use Illuminate\Support\Str;

/** Spec 015 US2: the team works the queue in admin. */
final class TeamTest extends SupportTestCase
{
    public function test_only_super_administrators_use_the_team_routes(): void
    {
        $ticket = $this->file(files: [$this->png()]);
        $attachment = $this->messages($ticket)[0]['attachments'][0]['uuid'];
        $member = $this->user('acme.moderator@example.test')->id;

        foreach (['platform-admin@example.test', 'acme.member@example.test', 'shared.operator@example.test'] as $email) {
            $this->actAs($email);
            $this->getJson($this->admin())->assertForbidden();
            $this->getJson($this->admin().'/summary')->assertForbidden();
            $this->getJson($this->admin().'/assignees')->assertForbidden();
            $this->getJson($this->admin($ticket['uuid']))->assertForbidden();
            $this->patchJson($this->admin($ticket['uuid']), ['revision' => 1, 'status' => 'declined'])->assertForbidden();
            $this->send($this->admin($ticket['uuid']).'/messages', ['client_id' => (string) Str::uuid(), 'body' => 'x'])->assertForbidden();
            $this->postJson($this->admin($ticket['uuid']).'/read')->assertForbidden();
            $this->get($this->admin($ticket['uuid']).'/attachments/'.$attachment, ['Accept' => 'application/json'])->assertForbidden();
            $this->getJson($this->admin($ticket['uuid']).'/people')->assertForbidden();
            $this->putJson($this->admin($ticket['uuid']).'/participants/'.$member)->assertForbidden();
            $this->deleteJson($this->admin($ticket['uuid']).'/participants/'.$member)->assertForbidden();
            $this->deleteJson($this->admin($ticket['uuid']))->assertForbidden();
        }
        $this->assertSame('new', Ticket::firstOrFail()->status->value);

        $this->actAs('acme.member@example.test');
        $this->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.capabilities.manage_tickets', false);
        $this->actAs('super-admin@example.test');
        $this->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.capabilities.manage_tickets', true);
    }

    public function test_field_changes_are_recorded_and_guarded_by_the_revision(): void
    {
        $ticket = $this->file();
        $admin = $this->actAs('super-admin@example.test');

        $changed = $this->patchJson($this->admin($ticket['uuid']), [
            'revision' => 1, 'status' => 'in_review', 'priority' => 'high', 'type' => 'improvement', 'assignee_id' => $admin->id,
        ])->assertOk()->json('data');
        $this->assertSame(2, $changed['revision']);
        $this->assertSame(['high', 'improvement', 'in_review'], [$changed['priority'], $changed['type'], $changed['status']]);
        $this->assertSame(['id' => $admin->id, 'name' => $admin->name], $changed['assignee']);
        $changes = collect($this->events($changed))->keyBy('event');
        $this->assertSame(['new', 'in_review'], [$changes['status']['from'], $changes['status']['to']]);
        $this->assertSame(['normal', 'high'], [$changes['priority']['from'], $changes['priority']['to']]);
        $this->assertSame(['id' => $admin->id, 'name' => $admin->name], $changes['assignee']['to']);
        $this->assertTrue($changes['priority']['internal']);

        // A stale revision changes nothing; a request that changes nothing records nothing.
        $this->patchJson($this->admin($ticket['uuid']), ['revision' => 1, 'status' => 'planned'])->assertConflict();
        $this->patchJson($this->admin($ticket['uuid']), ['revision' => 2, 'status' => 'in_review'])->assertOk()->assertJsonPath('data.revision', 2);
        $this->patchJson($this->admin($ticket['uuid']), ['revision' => 2, 'assignee_id' => $this->user('acme.member@example.test')->id])->assertUnprocessable();

        // People see the status and type changes, but not priority or assignee.
        $this->actAs('acme.member@example.test');
        $seen = $this->getJson($this->ticket($ticket['uuid']))->assertOk()->json('data');
        $this->assertSame(['created', 'status', 'type'], array_column($this->events($seen), 'event'));
        $this->assertArrayNotHasKey('priority', $seen);
        $this->assertArrayNotHasKey('assignee', $seen);
    }

    public function test_internal_notes_and_their_files_never_reach_people(): void
    {
        $ticket = $this->file();
        $this->actAs('super-admin@example.test');
        $note = $this->send($this->admin($ticket['uuid']).'/messages', ['client_id' => (string) Str::uuid(), 'body' => 'Probably the gateway firmware.', 'internal' => '1'], [$this->png('debug.png')])
            ->assertCreated()->json('data');
        $attachment = collect($this->messages($note))->firstWhere('internal', true)['attachments'][0]['uuid'];
        $this->get($this->admin($ticket['uuid']).'/attachments/'.$attachment)->assertOk();
        $this->assertTrue($note['awaiting_team'], 'A note is not an answer.');

        $this->actAs('acme.member@example.test');
        $seen = $this->getJson($this->ticket($ticket['uuid']))->assertOk()->json('data');
        $this->assertCount(1, $this->messages($seen));
        $this->assertStringNotContainsString('gateway firmware', json_encode($seen, JSON_THROW_ON_ERROR));
        $this->get($this->ticket($ticket['uuid']).'/attachments/'.$attachment)->assertNotFound();
        $this->getJson($this->tickets())->assertOk()->assertJsonPath('data.0.unread', false);
    }

    public function test_a_reply_with_a_status_is_one_action_and_answers_the_reporter(): void
    {
        $ticket = $this->file();

        $answered = $this->teamReply($ticket['uuid'], 'Which meter serial?', ['status' => 'needs_info', 'revision' => 1])->assertCreated()->json('data');
        $this->assertSame('needs_info', $answered['status']);
        $this->assertFalse($answered['awaiting_team']);
        $reply = collect($this->messages($answered))->last();
        $this->assertTrue($reply['from_team']);
        $this->assertSame('event', $answered['timeline'][array_key_last($answered['timeline'])]['type'], 'The status change follows the reply it came with.');
        $this->teamReply($ticket['uuid'], 'And the firmware?', ['status' => 'planned', 'revision' => 1])->assertConflict();

        $this->actAs('acme.member@example.test');
        $this->getJson($this->tickets())->assertOk()->assertJsonPath('data.0.unread', true);
        $this->getJson($this->tickets().'/summary')->assertOk()->assertJsonPath('data.unread', 1);
        $this->postJson($this->ticket($ticket['uuid']).'/read')->assertNoContent();
        $this->getJson($this->tickets().'/summary')->assertOk()->assertJsonPath('data.unread', 0);
    }

    public function test_the_queue_puts_tickets_awaiting_the_team_first(): void
    {
        $answered = $this->file(overrides: ['title' => 'Answered one']);
        $waiting = $this->file('acme.moderator@example.test', ['title' => 'Waiting one']);
        $other = $this->file('northstar.member@example.test', ['title' => 'Northstar one'], organization: $this->northstar);
        $this->teamReply($answered['uuid'])->assertCreated();
        $this->teamReply($other['uuid'], 'Done', ['status' => 'resolved', 'revision' => 1])->assertCreated();

        $queue = $this->getJson($this->admin())->assertOk();
        $this->assertSame([$waiting['uuid'], $answered['uuid']], array_column($queue->json('data'), 'uuid'));
        $queue->assertJsonPath('meta.awaiting', 1)->assertJsonPath('data.0.awaiting_team', true)->assertJsonPath('data.0.unread', true);
        $this->postJson($this->admin($waiting['uuid']).'/read')->assertNoContent();
        $this->getJson($this->admin())->assertOk()->assertJsonPath('data.0.unread', false);
        $this->getJson($this->admin().'/summary')->assertOk()->assertJsonPath('data.awaiting', 1);

        $this->getJson($this->admin().'?state=closed')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.organization.name', 'Northstar Utilities');
        $this->getJson($this->admin().'?state=all&organization='.$this->northstar->uuid)->assertOk()->assertJsonCount(1, 'data');
        $this->getJson($this->admin().'?status[]=new')->assertOk()->assertJsonCount(2, 'data');
        $this->getJson($this->admin().'?assignee=none')->assertOk()->assertJsonCount(2, 'data');
        $this->getJson($this->admin().'?assignee=me')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson($this->admin().'?awaiting=1')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson($this->admin().'?search=waiting')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson($this->admin().'/assignees')->assertOk()->assertJsonPath('data.0.email', 'super-admin@example.test');
    }
}
