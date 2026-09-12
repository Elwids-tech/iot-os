<?php

use App\Domain\Assistant\Services\AssistantRecovery;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;

Artisan::command('assistant:recover', function () {
    app(AssistantRecovery::class)->recover();
    $this->info('Stale assistant runs recovered.');
})->purpose('Release reservations and close interrupted assistant responses');

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');
