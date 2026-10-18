<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Support;

use App\Domain\Shared\Models\User;
use App\Domain\Support\Models\Ticket;

/** Spec 015 US4: tagging colleagues from the same organization. */
final class ParticipantsTest extends SupportTestCase
{
    public function test_a_tagged_colleague_reads_and_replies(): void
    {
        $ticket = $this->file();
        $colleague = $this->user('acme.moderator@example.test');

        $this->actAs('acme.member@example.test');
        $this->getJson($this->ticket($ticket['uuid']).'/people?search=moder')->assertOk()
            ->assertExactJson(['data' => [['id' => $colleague->id, 'name' => 'Acme Moderator', 'email' => 'acme.moderator@example.test']]]);
        $tagged = $this->tag('acme.member@example.test', $ticket['uuid'], 'acme.moderator@example.test')->assertOk()->json('data');
        $this->assertSame(['reporter', 'participant'], array_column($tagged['people'], 'role'));
        $added = $this->events($tagged, 'participant_added')[0];
        $this->assertSame(['id' => $colleague->id, 'name' => 'Acme Moderator'], $added['to']);
        $this->assertSame('Acme Member', $added['actor']['name']);
        // Tagging twice changes nothing; already-tagged people leave the search.
        $this->tag('acme.member@example.test', $ticket['uuid'], 'acme.moderator@example.test')->assertOk();
        $this->assertCount(1, $this->events($this->getJson($this->ticket($ticket['uuid']))->json('data'), 'participant_added'));
        $this->getJson($this->ticket($ticket['uuid']).'/people?search=moder')->assertOk()->assertJsonCount(0, 'data');

        $this->actAs('acme.moderator@example.test');
        $this->getJson($this->tickets())->assertOk()->assertJsonPath('data.0.role', 'participant')->assertJsonPath('data.0.unread', true);
        $seen = $this->getJson($this->ticket($ticket['uuid']))->assertOk()->json('data');
        $this->assertSame(['reply' => true, 'close' => false, 'edit_title' => false, 'manage_people' => false, 'leave' => true], $seen['abilities']);
        $this->reply('acme.moderator@example.test', $ticket['uuid'], 'Same here on line 2.', files: [$this->png('line2.png')])->assertCreated();
    }

    public function test_only_members_of_the_ticket_organization_can_be_tagged(): void
    {
        $ticket = $this->file();

        $this->actAs('acme.member@example.test');
        $this->getJson($this->ticket($ticket['uuid']).'/people?search=northstar')->assertOk()->assertJsonCount(0, 'data');
        $this->tag('acme.member@example.test', $ticket['uuid'], 'northstar.member@example.test')->assertUnprocessable()->assertJsonValidationErrors('user_id');
        $this->tag('acme.member@example.test', $ticket['uuid'], 'super-admin@example.test')->assertUnprocessable();
        // The team tags too, with the same rule.
        $this->actAs('super-admin@example.test');
        $this->putJson($this->admin($ticket['uuid']).'/participants/'.$this->user('northstar.admin@example.test')->id)->assertUnprocessable();
        $this->putJson($this->admin($ticket['uuid']).'/participants/'.$this->user('shared.operator@example.test')->id)->assertOk()
            ->assertJsonPath('data.people.1.email', 'shared.operator@example.test');
        $this->getJson($this->admin($ticket['uuid']).'/people')->assertOk()->assertJsonCount(1, 'data');
        $removed = $this->deleteJson($this->admin($ticket['uuid']).'/participants/'.$this->user('shared.operator@example.test')->id)->assertOk()->json('data');
        $this->assertCount(1, $removed['people']);
        $this->assertSame('Platform Super Admin', $this->events($removed, 'participant_removed')[0]['actor']['name']);
    }

    public function test_participants_cannot_tag_but_can_leave_and_the_reporter_removes(): void
    {
        $ticket = $this->file();
        $this->tag('acme.member@example.test', $ticket['uuid'], 'acme.moderator@example.test')->assertOk();
        $this->tag('acme.member@example.test', $ticket['uuid'], 'shared.operator@example.test')->assertOk();

        $this->tag('acme.moderator@example.test', $ticket['uuid'], 'shared.operator@example.test')->assertForbidden();
        $this->getJson($this->ticket($ticket['uuid']).'/people')->assertForbidden();
        $this->deleteJson($this->ticket($ticket['uuid']).'/participants/'.$this->user('shared.operator@example.test')->id)->assertForbidden();
        $this->deleteJson($this->ticket($ticket['uuid']).'/participants/'.$this->user('acme.member@example.test')->id)->assertForbidden();
        $this->deleteJson($this->ticket($ticket['uuid']).'/participants/'.$this->user('acme.moderator@example.test')->id)->assertNoContent();
        $this->getJson($this->ticket($ticket['uuid']))->assertNotFound();

        $this->actAs('acme.member@example.test');
        $this->deleteJson($this->ticket($ticket['uuid']).'/participants/'.$this->user('acme.member@example.test')->id)->assertNotFound();
        $this->deleteJson($this->ticket($ticket['uuid']).'/participants/'.$this->user('shared.operator@example.test')->id)->assertNoContent();
        $after = $this->getJson($this->ticket($ticket['uuid']))->assertOk()->json('data');
        $this->assertCount(1, $after['people']);
        $this->assertSame(['participant_added', 'participant_added', 'participant_left', 'participant_removed'], array_values(array_filter(array_column($this->events($after), 'event'), static fn (string $kind): bool => str_starts_with($kind, 'participant'))));
    }

    public function test_a_ticket_has_at_most_ten_participants(): void
    {
        $ticket = $this->file();
        foreach (range(1, 11) as $i) {
            $this->acme->users()->attach(User::factory()->create(['email' => "colleague$i@example.test"])->id);
        }
        foreach (range(1, 10) as $i) {
            $this->tag('acme.member@example.test', $ticket['uuid'], "colleague$i@example.test")->assertOk();
        }

        $this->tag('acme.member@example.test', $ticket['uuid'], 'colleague11@example.test')->assertUnprocessable()->assertJsonValidationErrors('user_id');
        $this->assertSame(10, Ticket::firstOrFail()->participants()->count());
    }
}
