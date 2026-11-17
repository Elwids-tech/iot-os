<?php

declare(strict_types=1);

namespace App\Domain\Notifications\Services;

use App\Domain\Notifications\Models\PushDevice;

/**
 * One push to every device a person has, and what came of it (spec 033, FR-026). A push
 * counts as sent when any device's push service accepted it, and is worth retrying only
 * while none did and at least one failed in passing.
 */
final readonly class PushFanOut
{
    /** @param  list<array{label: string, result: PushResult}>  $results */
    private function __construct(public array $results) {}

    /**
     * @param  iterable<PushDevice>  $devices
     * @param  array<string, mixed>  $payload
     * @param  array<string, mixed>  $options
     */
    public static function send(PushSender $sender, iterable $devices, array $payload, array $options): self
    {
        $results = [];
        foreach ($devices as $device) {
            $label = $device->label;
            $results[] = ['label' => $label, 'result' => $sender->send($device, $payload, $options)];
        }

        return new self($results);
    }

    public function total(): int
    {
        return count($this->results);
    }

    public function reached(): int
    {
        return count(array_filter($this->results, fn (array $r): bool => $r['result']->accepted()));
    }

    public function retryable(): bool
    {
        return $this->reached() === 0 && array_filter($this->results, fn (array $r): bool => $r['result']->transient()) !== [];
    }

    public function diagnostic(): ?string
    {
        if ($this->reached() > 0) {
            return null;
        }
        if ($this->total() === 0) {
            return 'Recipient has no push devices.';
        }

        return $this->retryable()
            ? 'Push services did not answer; retry scheduled.'
            : 'No device accepted the push.';
    }
}
