<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Passkeys belong to the domain they were made on (spec 036, FR-026): the deployment's
 * own, or a billing account's custom domain. Existing passkeys were all made on the
 * deployment's relying party.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('passkeys', function (Blueprint $table): void {
            $table->string('relying_party_id', 253)->default('');
            $table->index('relying_party_id');
        });

        DB::table('passkeys')->update(['relying_party_id' => strtolower((string) config('passkeys.relying_party_id'))]);
    }

    public function down(): void
    {
        Schema::table('passkeys', function (Blueprint $table): void {
            $table->dropIndex(['relying_party_id']);
            $table->dropColumn('relying_party_id');
        });
    }
};
