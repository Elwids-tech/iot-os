<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Console;

use App\Domain\Integrations\Models\Webhook;
use App\Domain\Integrations\Services\WebhookDispatch;
use App\Support\Operations;
use Illuminate\Console\Command;

final class WebhookWorker extends Command
{
    protected $signature = 'integrations:webhooks-work {--once} {--max-time=3600}';

    protected $description = 'Deliver durable integration webhook notifications';

    public function handle(WebhookDispatch $dispatch): int
    {
        $stop = false;
        $started = time();
        $last = 0;
        if (function_exists('pcntl_async_signals')) {
            pcntl_async_signals(true);
            pcntl_signal(SIGTERM, function () use (&$stop): void {
                $stop = true;
            });
            pcntl_signal(SIGINT, function () use (&$stop): void {
                $stop = true;
            });
        }
        do {
            Operations::heartbeat();
            $ids = Webhook::where('enabled', true)->where('id', '>', $last)->orderBy('id')->limit(50)->pluck('id');
            foreach ($ids as $id) {
                if ($stop) {
                    break;
                }
                try {
                    $dispatch->tick($id);
                } catch (\Throwable) {
                    $this->error('Webhook worker pass failed; durable work will be retried.');
                }
                $last = $id;
            }
            if ($ids->count() < 50) {
                $last = 0;
            }
            if ($this->option('once')) {
                break;
            }
            usleep(1000000);
        } while (! $stop && time() - $started < max(1, (int) $this->option('max-time')));

        return self::SUCCESS;
    }
}
