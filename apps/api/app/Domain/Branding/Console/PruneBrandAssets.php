<?php

declare(strict_types=1);

namespace App\Domain\Branding\Console;

use App\Domain\Branding\Services\BrandImages;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;

/**
 * Deletes brand images replaced or removed more than a day ago, with their files (spec
 * 036, constitution VII). The day lets pages already open keep showing the old image.
 */
final class PruneBrandAssets extends Command
{
    public const KEEP_HOURS = 24;

    protected $signature = 'branding:prune-assets {--now= : Prune as of this time instead of now}';

    protected $description = 'Delete brand images replaced more than a day ago';

    public function handle(BrandImages $images): int
    {
        $now = $this->option('now') ? CarbonImmutable::parse((string) $this->option('now')) : CarbonImmutable::now();
        $this->info(sprintf('Deleted %d replaced brand images.', $images->prune($now->subHours(self::KEEP_HOURS))));

        return self::SUCCESS;
    }
}
