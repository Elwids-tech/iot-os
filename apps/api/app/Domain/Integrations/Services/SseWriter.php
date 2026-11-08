<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Services;

use Closure;

/**
 * Writes server-sent event frames (spec 030, research R1): `event:`, an optional
 * `id:`, one `data:` line holding one JSON object, and a blank line; comment lines
 * carry no event. Every write is flushed through PHP's output buffers to the socket,
 * so a frame reaches the client as it is written. A sink replaces the output stream
 * in tests.
 */
final class SseWriter
{
    /**
     * @param  ?Closure(string): void  $sink  receives each chunk instead of the output stream
     */
    public function __construct(private readonly ?Closure $sink = null) {}

    /**
     * @param  array<string, mixed>  $data  one JSON object
     */
    public function event(string $name, ?string $id, array $data): void
    {
        $frame = "event: {$name}\n";
        if ($id !== null) {
            $frame .= "id: {$id}\n";
        }
        // JSON never holds a raw newline, so one data line carries the whole object.
        $frame .= 'data: '.json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)."\n\n";
        $this->write($frame);
    }

    public function comment(string $text): void
    {
        $this->write(': '.str_replace(["\r", "\n"], ' ', $text)."\n\n");
    }

    /** Frames another writer produced, relayed byte for byte. */
    public function raw(string $bytes): void
    {
        if ($bytes !== '') {
            $this->write($bytes);
        }
    }

    private function write(string $bytes): void
    {
        if ($this->sink !== null) {
            ($this->sink)($bytes);

            return;
        }
        echo $bytes;
        if (ob_get_level() > 0) {
            ob_flush();
        }
        flush();
    }
}
