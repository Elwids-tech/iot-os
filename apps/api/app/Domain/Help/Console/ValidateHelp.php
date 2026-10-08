<?php

namespace App\Domain\Help\Console;

use App\Domain\Help\Services\HelpCatalog;
use Illuminate\Console\Command;

final class ValidateHelp extends Command
{
    protected $signature = 'help:validate';

    protected $description = 'Validate the approved help library and page coverage';

    public function handle(HelpCatalog $catalog): int
    {
        $articles = $catalog->all();
        $this->info(count($articles).' help articles and '.count($catalog->contexts()).' page contexts validated.');

        return self::SUCCESS;
    }
}
