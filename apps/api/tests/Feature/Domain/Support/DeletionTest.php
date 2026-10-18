<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Support;

use App\Domain\Administration\Services\OrganizationDeletion;
use App\Domain\Shared\Models\Organization;
use App\Domain\Support\Models\Ticket;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/** Spec 015 US6 and FR-014. */
final class DeletionTest extends SupportTestCase
{
    public function test_the_team_deletes_a_ticket_with_its_files(): void
    {
        $ticket = $this->file(files: [$this->png()]);
        $this->teamReply($ticket['uuid'])->assertCreated();
        $this->assertNotSame([], Storage::disk('local')->allFiles());

        $this->actAs('super-admin@example.test');
        $this->deleteJson($this->admin($ticket['uuid']))->assertNoContent();

        $this->assertSame(0, Ticket::count());
        $this->assertSame(0, DB::table('support_ticket_messages')->count() + DB::table('support_ticket_events')->count() + DB::table('support_ticket_attachments')->count());
        $this->assertSame([], Storage::disk('local')->allFiles());
        $audit = DB::table('device_audit_events')->where('action', 'support.ticket_deleted')->sole();
        $this->assertSame($ticket['uuid'], $audit->resource_uuid);
        $this->assertSame(['number' => $ticket['number'], 'reporter_id' => $this->user('acme.member@example.test')->id], json_decode($audit->details, true));
        $this->assertStringNotContainsString('Devices page', $audit->details);

        // Numbers are never reused.
        $this->assertSame($ticket['number'] + 1, $this->file()['number']);
    }

    public function test_deleting_an_organization_keeps_its_tickets_for_the_team(): void
    {
        $cedar = Organization::create(['name' => 'Cedar Processing', 'slug' => 'cedar-processing']);
        $cedar->users()->attach([$this->user('acme.member@example.test')->id, $this->user('acme.moderator@example.test')->id]);
        $ticket = $this->file(organization: $cedar);
        $this->actAs('acme.member@example.test');
        $this->putJson($this->ticket($ticket['uuid'], $cedar).'/participants/'.$this->user('acme.moderator@example.test')->id)->assertOk();

        app(OrganizationDeletion::class)->delete($cedar, $this->user('super-admin@example.test'));

        $kept = Ticket::where('uuid', $ticket['uuid'])->firstOrFail();
        $this->assertNull($kept->organization_id);
        $this->assertSame(0, $kept->participants()->count());
        $this->actAs('super-admin@example.test');
        $this->getJson($this->admin($ticket['uuid']))->assertOk()->assertJsonPath('data.organization', null)->assertJsonCount(1, 'data.people');
        $this->getJson($this->admin().'?state=all')->assertOk()->assertJsonPath('data.0.organization', null);
    }
}
