<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Sites cut calendar periods (days, months, shifts) in their own IANA time
        // zone; devices without a site use the organization's zone.
        Schema::create('sites', function (Blueprint $t): void {
            $t->id();
            $t->uuid('uuid')->unique();
            $t->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $t->string('name', 120);
            $t->string('timezone', 64);
            $t->text('address')->nullable();
            $t->decimal('latitude', 9, 6)->nullable();
            $t->decimal('longitude', 9, 6)->nullable();
            $t->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $t->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamps();
            $t->unique(['organization_id', 'name']);
        });
        Schema::table('organizations', function (Blueprint $t): void {
            $t->string('timezone', 64)->nullable();
        });
        Schema::table('devices', function (Blueprint $t): void {
            $t->foreignId('site_id')->nullable()->constrained('sites')->nullOnDelete();
            $t->json('tags')->nullable();
            // Not "attributes": that name collides with Eloquent's internal attribute storage.
            $t->json('custom_attributes')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('devices', function (Blueprint $t): void {
            $t->dropConstrainedForeignId('site_id');
            $t->dropColumn(['tags', 'custom_attributes']);
        });
        Schema::table('organizations', function (Blueprint $t): void {
            $t->dropColumn('timezone');
        });
        Schema::dropIfExists('sites');
    }
};
