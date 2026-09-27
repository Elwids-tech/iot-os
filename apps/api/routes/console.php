<?php

use App\Domain\Assistant\Services\AssistantRecovery;
use App\Support\Operations;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schedule;

Artisan::command('assistant:recover', function () {
    app(AssistantRecovery::class)->recover();
    $this->info('Stale assistant runs recovered.');
})->purpose('Release reservations and close interrupted assistant responses');

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::call(fn () => Operations::heartbeat('scheduler'))->everyMinute();
Schedule::command('assistant:recover')->everyMinute()->withoutOverlapping();

Schedule::call(function (): void {
    if (config('deployment.ops_enabled')) {
        DB::table('operation_http_buckets')->where('minute', '<', time() - 3600)->delete();
    }
})->everyFiveMinutes();
