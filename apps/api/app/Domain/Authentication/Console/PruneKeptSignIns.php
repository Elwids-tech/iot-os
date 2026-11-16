<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Console;

use App\Domain\Authentication\Models\KeptSignIn;
use Illuminate\Console\Command;
use Illuminate\Database\Eloquent\Builder;

/** Kept sign-ins that ended or expired more than 30 days ago are deleted (spec 033, data model). */
final class PruneKeptSignIns extends Command
{
    public const DAYS = 30;

    protected $signature = 'auth:prune-kept-sign-ins';

    protected $description = 'Delete kept sign-ins that ended or expired more than 30 days ago';

    public function handle(): int
    {
        $cutoff = now()->subDays(self::DAYS);
        $deleted = 0;
        do {
            $ids = KeptSignIn::query()
                ->where(fn (Builder $query) => $query->where('ended_at', '<', $cutoff)->orWhere('expires_at', '<', $cutoff))
                ->limit(1000)->pluck('id');
            $deleted += $ids->isEmpty() ? 0 : KeptSignIn::query()->whereIn('id', $ids)->delete();
        } while ($ids->count() === 1000);
        $this->info("Pruned {$deleted} kept sign-ins.");

        return self::SUCCESS;
    }
}
