<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Gives every organization without a billing account one of its own (spec 023
 * FR-003): named after it, limit 1, no owners, assigned from the organization's
 * creation so no moment since then is left uncovered. It uses the query builder so
 * model hooks cannot add a second account, and a second run changes nothing.
 */
final class BillingAccountBackfill
{
    public static function run(): void
    {
        self::accounts();
        self::assignments();
    }

    /**
     * Separate from the assignments because the migration makes the key required before
     * the assignments table exists: on SQLite that change rebuilds `organizations`, and
     * the rebuild would clear assignment keys that point at it.
     */
    public static function accounts(): void
    {
        DB::table('organizations')
            ->whereNull('billing_account_id')
            ->select(['id', 'name'])
            ->lazyById(200)
            ->each(function (object $organization): void {
                $now = now();
                $accountId = DB::table('billing_accounts')->insertGetId([
                    'uuid' => (string) Str::uuid(),
                    'name' => $organization->name,
                    'organization_limit' => 1,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);

                DB::table('organizations')->where('id', $organization->id)->update(['billing_account_id' => $accountId]);
            });
    }

    public static function assignments(): void
    {
        DB::table('organizations')
            ->whereNotExists(fn ($query) => $query
                ->selectRaw('1')
                ->from('billing_account_assignments')
                ->whereColumn('billing_account_assignments.organization_uuid', 'organizations.uuid'))
            ->select(['id', 'uuid', 'name', 'billing_account_id', 'created_at'])
            ->lazyById(200)
            ->each(function (object $organization): void {
                DB::table('billing_account_assignments')->insert([
                    'billing_account_id' => $organization->billing_account_id,
                    'organization_id' => $organization->id,
                    'organization_uuid' => $organization->uuid,
                    'organization_name' => $organization->name,
                    'started_at' => $organization->created_at ?? now(),
                ]);
            });
    }
}
