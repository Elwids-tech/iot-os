<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('profile_parameters', function (Blueprint $table) {
            $table->json('ingress_conversion')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('profile_parameters', function (Blueprint $table) {
            $table->dropColumn('ingress_conversion');
        });
    }
};
