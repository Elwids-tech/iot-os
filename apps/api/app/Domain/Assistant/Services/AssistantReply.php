<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Services;

use Laravel\Ai\Streaming\Events\TextDelta;

/**
 * A reply as people read it, built from the provider's text deltas. Each provider
 * message is a paragraph, and a message that only repeats an earlier one is left out:
 * OpenAI can send the same message twice in one step, and the SDK's combined text then
 * shows the reply twice. The text only grows at its end, so streamed deltas stay valid.
 */
final class AssistantReply
{
    /** @var array<string, string> */
    private array $messages = [];

    private int $step = 0;

    private string $text = '';

    /** A provider step starts; its messages are new paragraphs even if a provider reuses ids. */
    public function step(): void
    {
        $this->step++;
    }

    /** Adds a delta and returns the text it appended to the visible reply. */
    public function add(TextDelta $delta): string
    {
        $key = $this->step.':'.$delta->messageId;
        $this->messages[$key] = ($this->messages[$key] ?? '').$delta->delta;
        $shown = [];
        foreach ($this->messages as $message) {
            $message = trim($message);
            // A repeat is hidden while it matches the start of an earlier message, and shown once it differs.
            if ($message !== '' && ! collect($shown)->contains(fn (string $earlier) => str_starts_with($earlier, $message))) {
                $shown[] = $message;
            }
        }
        $next = implode("\n\n", $shown);
        $appended = str_starts_with($next, $this->text) ? substr($next, strlen($this->text)) : '';
        $this->text = $next;

        return $appended;
    }

    public function text(): string
    {
        return $this->text;
    }
}
