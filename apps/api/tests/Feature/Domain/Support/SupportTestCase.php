<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Support;

use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Seeded people: Acme has shared.operator (admin), acme.moderator and acme.member;
 * Northstar has shared.operator, northstar.admin and northstar.member. The super
 * administrator and the platform administrator belong to no organization.
 */
abstract class SupportTestCase extends TestCase
{
    use RefreshDatabase;

    protected const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    protected Organization $acme;

    protected Organization $northstar;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        Storage::fake('local');
        Queue::fake();
        $this->acme = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
    }

    protected function user(string $email): User
    {
        return User::where('email', $email)->firstOrFail();
    }

    protected function actAs(string $email): User
    {
        $user = $this->user($email);
        $this->actingAs($user, 'sanctum');

        return $user;
    }

    protected function tickets(?Organization $organization = null): string
    {
        return '/api/v1/organizations/'.($organization ?? $this->acme)->uuid.'/tickets';
    }

    protected function ticket(string $uuid, ?Organization $organization = null): string
    {
        return $this->tickets($organization).'/'.$uuid;
    }

    protected function admin(string $uuid = ''): string
    {
        return '/api/v1/admin/tickets'.($uuid === '' ? '' : '/'.$uuid);
    }

    /**
     * File a ticket as the given person and return it.
     *
     * @param  array<string, mixed>  $overrides
     * @param  list<UploadedFile>  $files
     * @return array<string, mixed>
     */
    protected function file(string $email = 'acme.member@example.test', array $overrides = [], array $files = [], ?Organization $organization = null): array
    {
        $this->actAs($email);

        return $this->send($this->tickets($organization), $this->filing($overrides), $files)->assertCreated()->json('data');
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    protected function filing(array $overrides = []): array
    {
        return [
            'client_id' => (string) Str::uuid(),
            'type' => 'bug',
            'title' => 'Devices page shows no readings',
            'body' => "Steps:\n1. Open Devices\n2. Pick the pump meter\n\nExpected readings, saw none.",
            'context' => ['path' => '/organizations/x/devices', 'user_agent' => 'Mozilla/5.0 Test', 'screen' => '1440x900', 'time_zone' => 'Asia/Colombo'],
            ...$overrides,
        ];
    }

    /**
     * A multipart POST, as the portal sends it.
     *
     * @param  array<string, mixed>  $data
     * @param  list<UploadedFile>  $files
     */
    protected function send(string $url, array $data, array $files = []): TestResponse
    {
        return $this->withHeaders(['Accept' => 'application/json'])->post($url, $files === [] ? $data : [...$data, 'files' => $files]);
    }

    /**
     * A reply as the given person.
     *
     * @param  array<string, mixed>  $overrides
     * @param  list<UploadedFile>  $files
     */
    protected function reply(string $email, string $uuid, string $body = 'More detail here.', array $overrides = [], array $files = []): TestResponse
    {
        $this->actAs($email);

        return $this->send($this->ticket($uuid).'/messages', ['client_id' => (string) Str::uuid(), 'body' => $body, ...$overrides], $files);
    }

    /**
     * A team reply or note from the admin app.
     *
     * @param  array<string, mixed>  $overrides
     */
    protected function teamReply(string $uuid, string $body = 'Thanks, looking into it.', array $overrides = []): TestResponse
    {
        $this->actAs('super-admin@example.test');

        return $this->send($this->admin($uuid).'/messages', ['client_id' => (string) Str::uuid(), 'body' => $body, ...$overrides]);
    }

    protected function png(string $name = 'screen.png'): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, base64_decode(self::PNG));
    }

    protected function pdf(string $name = 'report.pdf'): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, "%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
    }

    protected function tag(string $reporter, string $uuid, string $email): TestResponse
    {
        $this->actAs($reporter);

        return $this->putJson($this->ticket($uuid).'/participants/'.$this->user($email)->id);
    }

    /**
     * @param  array<string, mixed>  $ticket
     * @return list<array<string, mixed>>
     */
    protected function events(array $ticket, ?string $kind = null): array
    {
        return array_values(array_filter($ticket['timeline'], static fn (array $item): bool => $item['type'] === 'event' && ($kind === null || $item['event'] === $kind)));
    }

    /**
     * @param  array<string, mixed>  $ticket
     * @return list<array<string, mixed>>
     */
    protected function messages(array $ticket): array
    {
        return array_values(array_filter($ticket['timeline'], static fn (array $item): bool => $item['type'] === 'message'));
    }
}
