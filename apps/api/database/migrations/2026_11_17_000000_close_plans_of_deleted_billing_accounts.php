<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Ends the plan of each billing account deleted before deleting ended it (spec 028
 * FR-002), at the moment it was deleted, so plan counts and lists leave it out.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('billing_accounts')
            ->whereNotNull('deleted_at')
            ->select(['id', 'deleted_at'])
            ->lazyById(200)
            ->each(function (object $account): void {
                DB::table('billing_plan_assignments')
                    ->where('billing_account_id', $account->id)
                    ->whereNull('ended_at')
                    ->update(['ended_at' => $account->deleted_at, 'end_reason' => 'account_deleted']);
            });
    }

    public function down(): void
    {
        // The plans stay ended: reopening them would count deleted accounts again.
    }
};
