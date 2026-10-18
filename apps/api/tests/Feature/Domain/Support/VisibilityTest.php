<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Support;

use App\Domain\Support\Models\Ticket;
use Illuminate\Support\Str;

/**
 * Spec 015 FR-003 and Constitution III: only the reporter and tagged members who still
 * belong to the ticket's organization reach it.
 */
final class VisibilityTest extends SupportTestCase
{
    public function test_an_untagged_member_of_the_same_organization_cannot_reach_the_ticket(): void
    {
        $ticket = $this->file(files: [$this->png()]);
        $attachment = $this->messages($ticket)[0]['attachments'][0]['uuid'];

        $this->assertUnreachable('acme.moderator@example.test', $ticket['uuid'], $attachment);
        // The organization administrator has no special access either.
        $this->assertUnreachable('shared.operator@example.test', $ticket['uuid'], $attachment);
    }

    public function test_a_member_of_another_organization_cannot_reach_the_ticket_through_either_organization(): void
    {
        $ticket = $this->file(files: [$this->png()]);

        $this->actAs('northstar.member@example.test');
        $this->getJson($this->ticket($ticket['uuid']))->assertForbidden();
        $this->getJson($this->ticket($ticket['uuid'], $this->northstar))->assertNotFound();
        $this->send($this->ticket($ticket['uuid'], $this->northstar).'/messages', ['client_id' => (string) Str::uuid(), 'body' => 'hi'])->assertNotFound();
        $this->getJson($this->tickets($this->northstar))->assertOk()->assertJsonCount(0, 'data');
        $this->getJson($this->tickets($this->northstar).'/summary')->assertOk()->assertJsonPath('data.unread', 0);
    }

    public function test_a_member_who_leaves_the_organization_loses_the_ticket(): void
    {
        $ticket = $this->file();
        $this->tag('acme.member@example.test', $ticket['uuid'], 'acme.moderator@example.test')->assertOk();
        $this->actAs('acme.moderator@example.test');
        $this->getJson($this->ticket($ticket['uuid']))->assertOk();

        $this->acme->users()->detach($this->user('acme.moderator@example.test')->id);
        $this->acme->users()->detach($this->user('acme.member@example.test')->id);

        $this->actAs('acme.moderator@example.test');
        $this->getJson($this->ticket($ticket['uuid'], $this->northstar))->assertForbidden();
        $this->actAs('acme.member@example.test');
        $this->getJson($this->ticket($ticket['uuid']))->assertForbidden();
        $this->assertSame(1, Ticket::count());
    }

    public function test_a_ticket_belongs_to_the_organization_it_was_filed_in(): void
    {
        // shared.operator belongs to both organizations.
        $ticket = $this->file('shared.operator@example.test', organization: $this->northstar);

        $this->getJson($this->ticket($ticket['uuid'], $this->northstar))->assertOk();
        $this->getJson($this->ticket($ticket['uuid']))->assertNotFound();
        $this->getJson($this->tickets())->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_the_team_reaches_every_ticket_only_through_admin(): void
    {
        $ticket = $this->file();

        $this->actAs('super-admin@example.test');
        $this->getJson($this->admin($ticket['uuid']))->assertOk()->assertJsonPath('data.number', $ticket['number']);
        // Not a member and not on the ticket: the portal routes treat them like anyone else.
        $this->getJson($this->ticket($ticket['uuid']))->assertNotFound();
    }

    private function assertUnreachable(string $email, string $uuid, string $attachment): void
    {
        $this->actAs($email);
        $this->getJson($this->ticket($uuid))->assertNotFound();
        $this->patchJson($this->ticket($uuid), ['title' => 'Renamed'])->assertNotFound();
        $this->send($this->ticket($uuid).'/messages', ['client_id' => (string) Str::uuid(), 'body' => 'hi'])->assertNotFound();
        $this->postJson($this->ticket($uuid).'/read')->assertNotFound();
        $this->get($this->ticket($uuid).'/attachments/'.$attachment)->assertNotFound();
        $this->getJson($this->ticket($uuid).'/people')->assertNotFound();
        $this->putJson($this->ticket($uuid).'/participants/'.$this->user($email)->id)->assertNotFound();
        $this->getJson($this->tickets())->assertOk()->assertJsonCount(0, 'data');
        $this->getJson($this->tickets().'/summary')->assertOk()->assertJsonPath('data.unread', 0);
    }
}
