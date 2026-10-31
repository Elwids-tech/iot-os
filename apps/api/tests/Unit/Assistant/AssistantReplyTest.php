<?php

declare(strict_types=1);

namespace Tests\Unit\Assistant;

use App\Domain\Assistant\Services\AssistantReply;
use Laravel\Ai\Streaming\Events\TextDelta;
use PHPUnit\Framework\TestCase;

final class AssistantReplyTest extends TestCase
{
    /** Streams words of a message as the provider does and returns everything appended. */
    private function stream(AssistantReply $reply, string $messageId, string $text): string
    {
        $appended = '';
        foreach (explode(' ', $text) as $index => $word) {
            $appended .= $reply->add(new TextDelta('event', $messageId, $index > 0 ? ' '.$word : $word, 0));
        }

        return $appended;
    }

    public function test_a_message_repeated_in_the_same_step_is_shown_once(): void
    {
        $reply = new AssistantReply;
        $reply->step();
        $text = '**Path chosen:** webhook adapter. Next, create the secret in the **Connection** tab.';
        $streamed = $this->stream($reply, 'm1', $text).$this->stream($reply, 'm2', $text);

        $this->assertSame($text, $reply->text());
        $this->assertSame($text, $streamed);
    }

    public function test_distinct_messages_and_steps_are_paragraphs_and_deltas_only_append(): void
    {
        $reply = new AssistantReply;
        $reply->step();
        $streamed = $this->stream($reply, 'm1', 'I found the water meter profile.');
        // A second message that starts like the first is held back until it differs.
        $streamed .= $this->stream($reply, 'm2', 'I found the water meter profile. It has no adapter yet.');
        $reply->step();
        $streamed .= $this->stream($reply, 'm1', 'I proposed a new adapter.');

        $expected = "I found the water meter profile.\n\nI found the water meter profile. It has no adapter yet.\n\nI proposed a new adapter.";
        $this->assertSame($expected, $reply->text());
        $this->assertSame($expected, $streamed);
    }
}
