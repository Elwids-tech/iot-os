<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Push deliveries share the alert delivery table (`channel = 'push'`, spec 033 FR-030).
 * They record how many of the person's devices were tried and reached, and each attempt
 * row is one device: its label at the time and the push service's status.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('automation_alert_deliveries', function (Blueprint $table): void {
            $table->smallInteger('devices_total')->nullable()->comment('Push only: devices tried in the latest attempt');
            $table->smallInteger('devices_reached')->nullable()->comment('Push only: devices whose push service accepted it');
        });
        Schema::table('automation_alert_delivery_attempts', function (Blueprint $table): void {
            $table->string('device_label', 60)->nullable()->comment('Push only: the device label when it was tried');
            $table->smallInteger('response_status')->nullable()->comment('Push only: the push service HTTP status');
        });
    }

    public function down(): void
    {
        Schema::table('automation_alert_delivery_attempts', function (Blueprint $table): void {
            $table->dropColumn(['device_label', 'response_status']);
        });
        Schema::table('automation_alert_deliveries', function (Blueprint $table): void {
            $table->dropColumn(['devices_total', 'devices_reached']);
        });
    }
};
