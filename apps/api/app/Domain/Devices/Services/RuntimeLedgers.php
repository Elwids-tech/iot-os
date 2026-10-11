<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use Illuminate\Support\Facades\DB;

/**
 * Prunes the transactional outbox and the inbox deduplication ledger shared
 * with the Go runtime. Rows are kept for longer than the runtime's 7-day
 * JetStream retention, so a redelivered event is still recognised as a
 * duplicate; unpublished outbox rows are never removed.
 */
final class RuntimeLedgers
{
    public const KEEP_DAYS = 8;

    private const BATCH = 10000;

    /** @return array{outbox: int, inbox: int} */
    public function prune(): array
    {
        $cutoff = now()->subDays(self::KEEP_DAYS);

        return [
            'outbox' => $this->deleteInBatches('device_outbox', 'id', fn ($query) => $query->where('published_at', '<', $cutoff)),
            'inbox' => $this->deleteInBatches('device_inbox', 'uuid', fn ($query) => $query->where('received_at', '<', $cutoff)),
        ];
    }

    private function deleteInBatches(string $table, string $key, callable $scope): int
    {
        $deleted = 0;
        do {
            $batch = $scope(DB::table($table))->limit(self::BATCH)->pluck($key);
            $deleted += $batch->isEmpty() ? 0 : DB::table($table)->whereIn($key, $batch)->delete();
        } while ($batch->count() === self::BATCH);

        return $deleted;
    }
}
