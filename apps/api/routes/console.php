<?php

use App\Domain\Assistant\Services\AssistantRecovery;
use App\Domain\Devices\Services\RuntimeLedgers;
use App\Domain\Integrations\Services\StreamSessions;
use App\Support\Operations;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schedule;

Artisan::command('assistant:recover', function () {
    app(AssistantRecovery::class)->recover();
    $this->info('Stale assistant runs recovered.');
})->purpose('Release reservations and close interrupted assistant responses');

Artisan::command('devices:prune-ledgers', function (RuntimeLedgers $ledgers) {
    $deleted = $ledgers->prune();
    $this->info("Pruned {$deleted['outbox']} published outbox events and {$deleted['inbox']} inbox entries.");
})->purpose('Remove runtime outbox and inbox rows that no longer protect against redelivery');

Artisan::command('integrations:prune-stream-sessions', function (StreamSessions $sessions) {
    $deleted = $sessions->prune();
    $this->info("Pruned {$deleted} telemetry stream sessions older than ".StreamSessions::KEEP_DAYS.' days.');
})->purpose('Remove telemetry stream session rows that no longer count against a limit or interest an operator');

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::call(fn () => Operations::heartbeat('scheduler'))->everyMinute();
Schedule::command('assistant:recover')->everyMinute()->withoutOverlapping();
Schedule::command('devices:prune-ledgers')->dailyAt('03:15')->withoutOverlapping();
Schedule::command('agents:prune')->dailyAt('03:30')->withoutOverlapping();
Schedule::command('adapters:prune')->dailyAt('03:40')->withoutOverlapping();
Schedule::command('alerts:prune-notifications')->dailyAt('03:45')->withoutOverlapping();
Schedule::command('integrations:prune-stream-sessions')->dailyAt('03:50')->withoutOverlapping();
Schedule::command('billing:prune')->dailyAt('03:30')->withoutOverlapping();
Schedule::command('billing:device-peaks')->dailyAt('00:15')->withoutOverlapping();
Schedule::command('billing:retention-warnings')->dailyAt('08:00')->withoutOverlapping();
Schedule::command('billing:draft-invoices')->dailyAt('02:10')->withoutOverlapping();
Schedule::command('passport:purge')->dailyAt('03:35')->withoutOverlapping();

Schedule::call(function (): void {
    if (config('deployment.ops_enabled')) {
        DB::table('operation_http_buckets')->where('minute', '<', time() - 3600)->delete();
    }
})->everyFiveMinutes();
