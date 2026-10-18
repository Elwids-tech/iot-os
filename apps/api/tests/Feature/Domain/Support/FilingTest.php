<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Support;

use App\Domain\Support\Models\Ticket;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/** Spec 015 US1: filing a ticket. */
final class FilingTest extends SupportTestCase
{
    public function test_a_member_files_a_bug_with_a_screenshot_and_sees_it_in_support(): void
    {
        $ticket = $this->file(files: [$this->png()]);

        $this->assertSame('new', $ticket['status']);
        $this->assertSame('bug', $ticket['type']);
        $this->assertSame($this->acme->uuid, $ticket['organization']['uuid']);
        $this->assertSame(['path' => '/organizations/x/devices', 'user_agent' => 'Mozilla/5.0 Test', 'screen' => '1440x900', 'time_zone' => 'Asia/Colombo'], $ticket['context']);
        $this->assertSame([['id' => $this->user('acme.member@example.test')->id, 'name' => 'Acme Member', 'email' => 'acme.member@example.test', 'role' => 'reporter']], $ticket['people']);
        $this->assertSame(['reply' => true, 'close' => true, 'edit_title' => true, 'manage_people' => true, 'leave' => false], $ticket['abilities']);
        [$message] = $this->messages($ticket);
        $this->assertStringContainsString('Expected readings', $message['body']);
        $this->assertFalse($message['from_team']);
        $this->assertSame('screen.png', $message['attachments'][0]['name']);
        $this->assertSame('image/png', $message['attachments'][0]['mime']);
        $this->assertSame('created', $this->events($ticket)[0]['event']);
        Storage::disk('local')->assertExists(Ticket::where('uuid', $ticket['uuid'])->firstOrFail()->attachments()->value('path'));

        $this->getJson($this->tickets())->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.number', $ticket['number'])
            ->assertJsonPath('data.0.role', 'reporter')
            ->assertJsonPath('data.0.unread', false);
        $this->getJson($this->tickets().'/summary')->assertOk()->assertJsonPath('data.unread', 0);
    }

    public function test_numbers_are_sequential_and_titles_are_tidied(): void
    {
        $first = $this->file();
        $second = $this->file(overrides: ['title' => "  Add   a dark\tmode  ", 'type' => 'feature_request']);

        $this->assertSame($first['number'] + 1, $second['number']);
        $this->assertSame('Add a dark mode', $second['title']);
    }

    public function test_sending_the_same_form_twice_files_one_ticket(): void
    {
        $this->actAs('acme.member@example.test');
        $form = $this->filing();

        $first = $this->send($this->tickets(), $form)->assertCreated()->json('data.uuid');
        $again = $this->send($this->tickets(), $form)->assertCreated()->json('data.uuid');
        $this->send($this->tickets(), [...$form, 'title' => 'Something else'])->assertConflict();

        $this->assertSame($first, $again);
        $this->assertSame(1, Ticket::count());
    }

    public function test_the_form_is_validated(): void
    {
        $this->actAs('acme.member@example.test');

        $this->send($this->tickets(), $this->filing(['title' => 'ab']))->assertUnprocessable()->assertJsonValidationErrors('title');
        $this->send($this->tickets(), $this->filing(['title' => '   a   ']))->assertUnprocessable()->assertJsonValidationErrors('title');
        $this->send($this->tickets(), $this->filing(['type' => 'question']))->assertUnprocessable()->assertJsonValidationErrors('type');
        $this->send($this->tickets(), $this->filing(['body' => '  ']))->assertUnprocessable()->assertJsonValidationErrors('body');
        $this->send($this->tickets(), $this->filing(['body' => str_repeat('a', 10001)]))->assertUnprocessable()->assertJsonValidationErrors('body');
        $this->send($this->tickets(), $this->filing(['context' => ['path' => 'https://elsewhere.example.com']]))->assertUnprocessable()->assertJsonValidationErrors('context.path');
        $this->send($this->tickets(), $this->filing(), array_map(fn (int $i) => $this->png("s$i.png"), range(1, 6)))->assertUnprocessable()->assertJsonValidationErrors('files');
        $this->send($this->tickets(), $this->filing(), [UploadedFile::fake()->create('big.png', 10241, 'image/png')])->assertUnprocessable()->assertJsonValidationErrors('files.0');

        $this->assertSame(0, Ticket::count());
    }

    public function test_attachments_are_checked_by_content_and_a_message_can_be_only_a_file(): void
    {
        $this->actAs('acme.member@example.test');
        $html = UploadedFile::fake()->createWithContent('innocent.png', '<html><body><script>alert(1)</script></body></html>');
        $svg = UploadedFile::fake()->createWithContent('logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>');

        $errors = $this->send($this->tickets(), $this->filing(), [$this->png(), $html])->assertUnprocessable()->json('errors');
        $this->assertSame(['innocent.png is not a PNG, JPEG, WebP or PDF file.'], $errors['files.1']);
        $this->send($this->tickets(), $this->filing(), [$svg])->assertUnprocessable()->assertJsonValidationErrors('files.0');
        $this->assertSame([], Storage::disk('local')->allFiles());

        $ticket = $this->send($this->tickets(), $this->filing(['body' => '']), [$this->pdf()])->assertCreated()->json('data');
        $this->assertSame('', $this->messages($ticket)[0]['body']);
        $this->assertSame('application/pdf', $this->messages($ticket)[0]['attachments'][0]['mime']);
    }

    public function test_only_members_file_and_filing_is_rate_limited(): void
    {
        // Super administrators pass the organization middleware but are not Acme members.
        $this->actAs('super-admin@example.test');
        $this->send($this->tickets(), $this->filing())->assertForbidden();

        $this->actAs('acme.member@example.test');
        foreach (range(1, 10) as $i) {
            $this->send($this->tickets(), $this->filing(['client_id' => (string) Str::uuid()]))->assertCreated();
        }
        $this->send($this->tickets(), $this->filing())->assertTooManyRequests();
    }

    public function test_the_list_filters_and_searches(): void
    {
        $bug = $this->file();
        $idea = $this->file(overrides: ['type' => 'improvement', 'title' => 'Bigger charts on the dashboard']);
        $this->actAs('acme.member@example.test');
        $this->patchJson($this->ticket($bug['uuid']), ['status' => 'resolved'])->assertOk();

        $this->getJson($this->tickets())->assertOk()->assertJsonPath('data.0.uuid', $idea['uuid'])->assertJsonPath('data.1.uuid', $bug['uuid']);
        $this->getJson($this->tickets().'?status=open')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.uuid', $idea['uuid']);
        $this->getJson($this->tickets().'?status=closed')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.status', 'resolved');
        $this->getJson($this->tickets().'?type=improvement')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson($this->tickets().'?search=charts')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.uuid', $idea['uuid']);
        $this->getJson($this->tickets().'?search=%23'.$bug['number'])->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.uuid', $bug['uuid']);
    }
}
