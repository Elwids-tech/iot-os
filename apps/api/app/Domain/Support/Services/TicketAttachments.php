<?php

declare(strict_types=1);

namespace App\Domain\Support\Services;

use App\Domain\Support\Models\Ticket;
use App\Domain\Support\Models\TicketAttachment;
use App\Domain\Support\Models\TicketMessage;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Screenshots and PDFs on ticket messages (spec 015 FR-008). The type comes from the
 * content, never the name or the browser, and files are only ever served through an
 * authorized download.
 */
final class TicketAttachments
{
    public const DISK = 'local';

    public const MAX_KIB = 10240;

    public const PER_MESSAGE = 5;

    public const PER_TICKET = 50;

    /** Content type => stored extension. SVG and HTML are never accepted. */
    private const TYPES = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp', 'application/pdf' => 'pdf'];

    /**
     * @return array<string, mixed>
     */
    public static function rules(): array
    {
        return [
            'files' => ['sometimes', 'array', 'max:'.self::PER_MESSAGE],
            'files.*' => ['file', 'max:'.self::MAX_KIB],
        ];
    }

    /**
     * Refuses any file whose content is not an accepted type, naming the file.
     *
     * @param  list<UploadedFile>  $files
     * @return list<array{file: UploadedFile, mime: string}>
     */
    public function check(array $files): array
    {
        $checked = [];
        foreach (array_values($files) as $index => $file) {
            $mime = (string) (new \finfo(FILEINFO_MIME_TYPE))->file($file->getRealPath());
            if (! isset(self::TYPES[$mime])) {
                throw ValidationException::withMessages(["files.$index" => sprintf('%s is not a PNG, JPEG, WebP or PDF file.', $this->name($file))]);
            }
            $checked[] = ['file' => $file, 'mime' => $mime];
        }

        return $checked;
    }

    public function ensureRoom(Ticket $ticket, int $adding): void
    {
        if ($adding > 0 && $ticket->attachments()->count() + $adding > self::PER_TICKET) {
            throw ValidationException::withMessages(['files' => sprintf('A ticket can hold %d attachments. Link to larger material instead.', self::PER_TICKET)]);
        }
    }

    /**
     * Stores the checked files for a message. Paths written are added to $written so
     * the caller can remove them if its transaction fails.
     *
     * @param  list<array{file: UploadedFile, mime: string}>  $checked
     * @param  list<string>  $written
     */
    public function store(Ticket $ticket, TicketMessage $message, array $checked, array &$written): void
    {
        foreach ($checked as ['file' => $file, 'mime' => $mime]) {
            $uuid = (string) Str::uuid();
            $path = $file->storeAs($this->directory($ticket), $uuid.'.'.self::TYPES[$mime], self::DISK);
            if ($path === false) {
                throw new \RuntimeException('The attachment could not be stored.');
            }
            $written[] = $path;
            TicketAttachment::create([
                'uuid' => $uuid, 'ticket_id' => $ticket->id, 'message_id' => $message->id,
                'name' => $this->name($file), 'mime' => $mime, 'size' => (int) $file->getSize(), 'path' => $path,
                'created_at' => now(),
            ]);
        }
    }

    /** @param list<string> $paths */
    public function discard(array $paths): void
    {
        if ($paths !== []) {
            Storage::disk(self::DISK)->delete($paths);
        }
    }

    public function deleteAll(Ticket $ticket): void
    {
        Storage::disk(self::DISK)->deleteDirectory($this->directory($ticket));
    }

    /** Images open in the browser; PDFs always download. */
    public function response(TicketAttachment $attachment): StreamedResponse
    {
        $inline = str_starts_with($attachment->mime, 'image/');

        return Storage::disk(self::DISK)->response($attachment->path, $attachment->name, [
            'Content-Type' => $attachment->mime,
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'private, max-age=300',
            'Content-Security-Policy' => "default-src 'none'; sandbox",
        ], $inline ? 'inline' : 'attachment');
    }

    private function directory(Ticket $ticket): string
    {
        return 'support/'.$ticket->uuid;
    }

    private function name(UploadedFile $file): string
    {
        $name = trim(basename(str_replace('\\', '/', $file->getClientOriginalName())));

        return mb_substr($name !== '' ? $name : 'attachment', 0, 255);
    }
}
