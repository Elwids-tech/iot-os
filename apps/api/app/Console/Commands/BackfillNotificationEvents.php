<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Domain\Automation\Models\Alert;
use App\Domain\Notifications\Models\NotificationEvent;
use App\Domain\Notifications\Services\EventRecorder;
use Illuminate\Console\Command;

final class BackfillNotificationEvents extends Command
{
    protected $signature = 'notifications:backfill';

    protected $description = 'Import existing workflow alert history without sending emails';

    public function handle(EventRecorder $recorder): int
    {
        Alert::where('kind', Alert::WORKFLOW)->with('workflow')->chunkById(100, function ($alerts) use ($recorder): void {
            foreach ($alerts as $alert) {
                foreach (['activated' => $alert->activated_at, 'cleared' => $alert->cleared_at] as $type => $at) {
                    if ($at && ! NotificationEvent::where('event_key', hash('sha256', 'workflow:'.$alert->uuid.':'.$type))->exists()) {
                        $recorder->workflow($alert, $type, $at->toIso8601String());
                    }
                }
            }
        });
        $this->info('Workflow alert history imported. No emails sent.');

        return self::SUCCESS;
    }
}
