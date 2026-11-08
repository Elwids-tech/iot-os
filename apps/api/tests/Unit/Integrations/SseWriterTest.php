<?php

declare(strict_types=1);

namespace Tests\Unit\Integrations;

use App\Domain\Integrations\Services\SseWriter;
use PHPUnit\Framework\TestCase;

/** The SSE framing of spec 030 (research R1): what a client's event-source parser reads. */
final class SseWriterTest extends TestCase
{
    /** @var list<string> */
    private array $chunks = [];

    private function writer(): SseWriter
    {
        return new SseWriter(function (string $bytes): void {
            $this->chunks[] = $bytes;
        });
    }

    public function test_an_event_with_an_id_is_one_frame_with_a_single_data_line(): void
    {
        $this->writer()->event('reading', '42', ['schema_version' => 'telemetry-stream.v1', 'position' => '42', 'unit' => 'mm/s', 'note' => "two\nlines", 'value' => 1.5, 'historical' => false]);

        $this->assertSame(["event: reading\nid: 42\ndata: {\"schema_version\":\"telemetry-stream.v1\",\"position\":\"42\",\"unit\":\"mm/s\",\"note\":\"two\\nlines\",\"value\":1.5,\"historical\":false}\n\n"], $this->chunks);
        $this->assertCount(1, $this->chunks, 'one frame is one write, so it is flushed whole');
    }

    public function test_an_event_without_an_id_has_no_id_line(): void
    {
        $this->writer()->event('open', null, ['schema_version' => 'telemetry-stream-open.v1', 'position' => '0', 'devices' => 2, 'opened_at' => '2026-11-07T09:41:58Z']);

        $this->assertSame("event: open\ndata: {\"schema_version\":\"telemetry-stream-open.v1\",\"position\":\"0\",\"devices\":2,\"opened_at\":\"2026-11-07T09:41:58Z\"}\n\n", $this->chunks[0]);
        $this->assertStringNotContainsString("\nid:", $this->chunks[0]);
    }

    public function test_a_comment_carries_no_event_and_cannot_break_out_of_its_line(): void
    {
        $this->writer()->comment("keepalive\nevent: closed");

        $this->assertSame([": keepalive event: closed\n\n"], $this->chunks);
    }

    public function test_raw_frames_are_relayed_byte_for_byte_and_empty_chunks_are_skipped(): void
    {
        $writer = $this->writer();
        $writer->raw('');
        $writer->raw("event: reading\nid: 7\ndata: {\"a\":1}\n\n");

        $this->assertSame(["event: reading\nid: 7\ndata: {\"a\":1}\n\n"], $this->chunks);
    }

    public function test_without_a_sink_each_frame_is_flushed_through_the_output_buffers(): void
    {
        // The same capture Laravel's TestResponse::streamedContent() uses: every flush
        // hands the buffer to the callback, as a socket would receive it.
        $flushed = [];
        ob_start(static function (string $buffer) use (&$flushed): string {
            if ($buffer !== '') {
                $flushed[] = $buffer;
            }

            return '';
        });
        (new SseWriter)->event('reset', null, ['schema_version' => 'telemetry-stream-reset.v1', 'position' => '9031']);
        $this->assertSame(["event: reset\ndata: {\"schema_version\":\"telemetry-stream-reset.v1\",\"position\":\"9031\"}\n\n"], $flushed, 'the frame left the buffer before the writer returned');
        ob_end_clean();
    }
}
