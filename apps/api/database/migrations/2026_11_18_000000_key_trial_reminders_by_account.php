<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Keys trial reminders sent so far by their billing account instead of the plan
 * assignment (`trial:{account}:{end date}:7d|1d`), as `billing:end-trials` now does, so
 * a trial moved to another plan is not reminded again (spec 029 SC-008).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('billing_notices')
            ->join('billing_accounts', 'billing_accounts.id', '=', 'billing_notices.billing_account_id')
            ->where('billing_notices.kind', 'trial_reminder')
            ->select(['billing_notices.id', 'billing_notices.billing_account_id', 'billing_notices.key', 'billing_accounts.uuid'])
            ->orderBy('billing_notices.id')
            ->get()
            ->each(function (object $notice): void {
                $parts = explode(':', (string) $notice->key);
                if (count($parts) !== 4) {
                    return;
                }
                $key = implode(':', ['trial', $notice->uuid, $parts[2], $parts[3]]);
                $taken = DB::table('billing_notices')->where('billing_account_id', $notice->billing_account_id)->where('kind', 'trial_reminder')->where('key', $key)->where('id', '!=', $notice->id)->exists();

                // Two assignments of one trial already reminded on the same date: keep one.
                // A row already keyed by the account is not taken by itself and stays.
                $taken
                    ? DB::table('billing_notices')->where('id', $notice->id)->delete()
                    : DB::table('billing_notices')->where('id', $notice->id)->update(['key' => $key]);
            });
    }

    public function down(): void
    {
        // Sent reminders keep the account's key: rebuilding the assignment's could send them again.
    }
};
