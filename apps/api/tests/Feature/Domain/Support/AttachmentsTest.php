<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Support;

use App\Domain\Support\Models\Ticket;
use App\Domain\Support\Models\TicketAttachment;
use Illuminate\Support\Str;

/** Spec 015 FR-008: attachments are private and served safely. */
final class AttachmentsTest extends SupportTestCase
{
    public function test_images_open_inline_and_pdfs_download_with_their_stored_type(): void
    {
        $ticket = $this->file(files: [$this->png(), $this->pdf()]);
        [$image, $pdf] = $this->messages($ticket)[0]['attachments'];

        $shown = $this->get($this->ticket($ticket['uuid']).'/attachments/'.$image['uuid'])->assertOk();
        $this->assertSame('image/png', $shown->headers->get('Content-Type'));
        $this->assertSame('nosniff', $shown->headers->get('X-Content-Type-Options'));
        $this->assertStringStartsWith('inline;', (string) $shown->headers->get('Content-Disposition'));
        $this->assertSame(base64_decode(self::PNG), $shown->streamedContent());

        $downloaded = $this->get($this->ticket($ticket['uuid']).'/attachments/'.$pdf['uuid'])->assertOk();
        $this->assertSame('application/pdf', $downloaded->headers->get('Content-Type'));
        $this->assertStringStartsWith('attachment;', (string) $downloaded->headers->get('Content-Disposition'));

        // An attachment is only reachable through its own ticket.
        $other = $this->file();
        $this->get($this->ticket($other['uuid']).'/attachments/'.$image['uuid'])->assertNotFound();
    }

    public function test_a_ticket_holds_at_most_fifty_attachments(): void
    {
        $ticket = $this->file(files: [$this->png()]);
        $model = Ticket::where('uuid', $ticket['uuid'])->firstOrFail();
        $message = $model->messages()->firstOrFail();
        foreach (range(1, 48) as $i) {
            TicketAttachment::create(['ticket_id' => $model->id, 'message_id' => $message->id, 'name' => "s$i.png", 'mime' => 'image/png', 'size' => 70, 'path' => 'support/x/'.Str::uuid().'.png', 'created_at' => now()]);
        }

        $this->reply('acme.member@example.test', $ticket['uuid'], 'Two more.', files: [$this->png('a.png'), $this->png('b.png')])
            ->assertUnprocessable()->assertJsonValidationErrors('files');
        $this->reply('acme.member@example.test', $ticket['uuid'], 'One more.', files: [$this->png('a.png')])->assertCreated();
        $this->assertSame(50, $model->attachments()->count());
    }
}
