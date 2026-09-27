<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

final class QuarantineRestoredSideEffects extends Command
{
    protected $signature = 'deployment:quarantine-restore';

    protected $description = 'Cancel restored external side effects before an isolated recovery is resumed';

    public function handle(): int
    {
        if (! config('deployment.recovery_mode')) {
            $this->error('This command requires explicit IOT_RECOVERY_MODE=true on the isolated restore job.');

            return self::FAILURE;
        }
        DB::transaction(function (): void {
            DB::table('jobs')->delete();
            DB::table('device_commands')->whereNotNull('outstanding_key')->update(['status' => 'uncertain', 'outstanding_key' => null, 'completed_at' => now(), 'expires_at' => now(), 'diagnostic' => 'Cancelled by isolated backup recovery; never replay automatically.']);
            DB::table('device_outbox')->where('type', 'device.command.v1')->whereNull('published_at')->update(['published_at' => now()]);
            DB::table('automation_alert_deliveries')->where('status', 'pending')->update(['status' => 'failed', 'diagnostic' => 'Suppressed by isolated backup recovery.']);
            DB::table('integration_webhooks')->update(['enabled' => false]);
            DB::table('integration_webhook_deliveries')->where('status', 'pending')->update(['status' => 'cancelled', 'diagnostic' => 'Suppressed by isolated backup recovery.']);
            if (DB::getDriverName() === 'pgsql') {
                // Quarantine job is run with the postgres recovery role, not the API role.
                DB::table('device_runtime.commands')->whereIn('status', ['dispatching', 'sent'])->update(['status' => 'uncertain', 'expires_at' => now(), 'diagnostic' => 'Suppressed by backup recovery.']);
            }
        });
        $this->info('Restored commands and queued notifications suppressed; webhooks disabled. Review before resuming.');

        return self::SUCCESS;
    }
}
