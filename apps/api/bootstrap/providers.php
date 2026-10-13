<?php

use App\Domain\Agents\AgentsServiceProvider;
use App\Providers\AppServiceProvider;
use App\Support\Contract\ContractServiceProvider;
use Dedoc\Scramble\Scramble;

return array_values(array_filter([
    AppServiceProvider::class,
    AgentsServiceProvider::class,
    // The contract generator (dedoc/scramble) is a dev dependency; release images lack it.
    class_exists(Scramble::class) ? ContractServiceProvider::class : null,
]));
