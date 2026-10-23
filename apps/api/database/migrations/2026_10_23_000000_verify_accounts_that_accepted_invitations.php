<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Accepting an invitation proves the email address, but accounts created that way were
 * saved unverified (email_verified_at is not fillable), so they could never receive alert
 * email. Verify them as of their first accepted invitation. Already verified accounts are
 * left alone, so running this again changes nothing.
 */
return new class extends Migration
{
    public function up(): void
    {
        $accepted = fn (): Builder => DB::table('organization_invitations')
            ->whereColumn('organization_invitations.email', 'users.email')
            ->whereNotNull('organization_invitations.accepted_at');

        DB::table('users')
            ->whereNull('email_verified_at')
            ->whereExists($accepted())
            ->update(['email_verified_at' => $accepted()->selectRaw('min(organization_invitations.accepted_at)')]);
    }

    /**
     * Backfilled accounts cannot be told apart from ones verified since, so nothing is undone.
     */
    public function down(): void {}
};
