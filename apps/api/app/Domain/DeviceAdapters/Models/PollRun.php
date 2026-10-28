<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Models;

use App\Domain\Devices\Models\DeviceModel;

/** One scheduled execution of an HTTP polling source, as the runtime reported it. */
final class PollRun extends DeviceModel
{
    protected $table = 'device_adapter_poll_runs';

    protected function casts(): array
    {
        return ['started_at' => 'datetime', 'finished_at' => 'datetime', 'next_attempt_at' => 'datetime'];
    }

    public function view(): array
    {
        return [...$this->only(['uuid', 'run_id', 'outcome', 'http_status', 'pages', 'records', 'published', 'failed', 'duplicates', 'cursor_before', 'cursor_after', 'error']),
            'started_at' => $this->started_at?->toIso8601String(), 'finished_at' => $this->finished_at?->toIso8601String(), 'next_attempt_at' => $this->next_attempt_at?->toIso8601String()];
    }
}
