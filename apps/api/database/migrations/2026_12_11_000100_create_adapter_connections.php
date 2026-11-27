<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Connections to servers that data sources read from (spec 038, ADR-052): one saved
 * link to one OPC UA server, shared by the data sources that use it. Device adapters
 * gain the connection they read through, and tenants the private ranges the platform
 * operator lets an organization's connections reach (research R10).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('adapter_connections', function (Blueprint $t): void {
            $t->id();
            $t->uuid('uuid')->unique();
            $t->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $t->string('protocol', 16)->default('opcua');
            $t->string('name', 120);
            $t->string('endpoint_url', 512);
            $t->string('runs_at', 16)->default('platform');
            $t->unsignedBigInteger('adapter_agent_id')->nullable();
            $t->string('security_policy', 32)->default('Basic256Sha256');
            $t->string('security_mode', 16)->default('SignAndEncrypt');
            $t->foreignId('unencrypted_confirmed_by')->nullable()->constrained('users')->nullOnDelete();
            $t->string('identity', 16)->default('anonymous');
            $t->text('secrets');
            $t->text('client_certificate');
            $t->timestamp('client_certificate_expires_at');
            $t->json('server_certificate')->nullable();
            $t->json('pending_server_certificate')->nullable();
            $t->string('state', 16)->default('draft');
            $t->json('status')->nullable();
            $t->json('refused_points')->nullable();
            $t->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $t->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamps();
            $t->unique(['organization_id', 'name']);
        });
        Schema::table('device_adapters', function (Blueprint $t): void {
            $t->foreignId('adapter_connection_id')->nullable()->after('organization_id')->constrained('adapter_connections')->restrictOnDelete();
        });
        Schema::table('device_adapter_tenants', function (Blueprint $t): void {
            $t->json('private_ranges')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('device_adapter_tenants', function (Blueprint $t): void {
            $t->dropColumn('private_ranges');
        });
        Schema::table('device_adapters', function (Blueprint $t): void {
            $t->dropConstrainedForeignId('adapter_connection_id');
        });
        Schema::dropIfExists('adapter_connections');
    }
};
