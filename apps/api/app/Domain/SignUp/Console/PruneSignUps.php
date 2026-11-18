<?php

declare(strict_types=1);

namespace App\Domain\SignUp\Console;

use App\Domain\SignUp\Models\SignUp;
use Illuminate\Console\Command;

/**
 * Unconfirmed sign-ups go after 7 days and refused ones after 30 (spec 035 FR-013,
 * research R13). Completed ones stay as the record of where an organization came from.
 */
final class PruneSignUps extends Command
{
    public const WAITING_DAYS = 7;

    public const REFUSED_DAYS = 30;

    protected $signature = 'sign-ups:prune';

    protected $description = 'Delete sign-ups never confirmed within 7 days and refused ones older than 30 days';

    public function handle(): int
    {
        $waiting = SignUp::query()->where('state', SignUp::WAITING)->where('created_at', '<', now()->subDays(self::WAITING_DAYS))->delete();
        $refused = SignUp::query()->where('state', SignUp::REFUSED)->where('created_at', '<', now()->subDays(self::REFUSED_DAYS))->delete();
        SignUp::query()->where('state', SignUp::COMPLETED)->whereNotNull('password')->update(['password' => null]);
        $this->info("Pruned {$waiting} unconfirmed and {$refused} refused sign-ups.");

        return self::SUCCESS;
    }
}
