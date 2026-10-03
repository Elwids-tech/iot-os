<?php

declare(strict_types=1);

namespace App\Domain\Automation\Console;

use App\Domain\Automation\Services\DagActions;
use App\Support\Operations;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

final class AutomationWorker extends Command
{
    protected $signature = 'automation:work {--once} {--max-time=3600}';

    protected $description = 'Dispatch durable DAG action intents and reconcile command outcomes';

    public function handle(DagActions $actions): int
    {
        $started = time();
        $stop = false;
        if (function_exists('pcntl_async_signals')) {
            pcntl_async_signals(true);
            pcntl_signal(SIGTERM, function () use (&$stop) {
                $stop = true;
            });
        }
        do {
            Operations::heartbeat();
            foreach (DB::table('automation_actions')->whereIn('status', ['accepted', 'dispatched'])->orderBy('updated_at')->limit(100)->pluck('id') as $id) {
                try {
                    $actions->tick($id);
                } catch (\Throwable $e) {
                    report($e);
                    $this->error('Automation action deferred; durable state retained.');
                }
            }if ($this->option('once')) {
                break;
            }usleep(1000000);
        } while (! $stop && time() - $started < max(1, (int) $this->option('max-time')));

        return self::SUCCESS;
    }
}
