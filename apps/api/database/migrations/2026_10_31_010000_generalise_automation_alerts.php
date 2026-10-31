<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * One alerts table for workflow alerts and device connectivity alerts (spec 018, D7).
 * Workflow alerts keep their workflow and deployment; the other kinds name a device,
 * gateway or adapter instead. The devices an alert concerns are listed in
 * automation_alert_devices, backfilled for workflow alerts from their bound device.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('automation_alerts', function (Blueprint $table): void {
            $table->string('kind', 32)->default('workflow')->after('organization_id');
            $table->string('severity', 16)->default('warning')->after('kind');
            $table->foreignId('automation_workflow_id')->nullable()->change();
            $table->foreignId('automation_deployment_id')->nullable()->change();
            $table->string('episode_key', 160)->nullable()->unique();
            $table->foreignId('subject_device_id')->nullable()->constrained('devices')->restrictOnDelete();
            $table->foreignId('subject_gateway_id')->nullable()->constrained('sparkplug_gateways')->restrictOnDelete();
            $table->foreignId('subject_adapter_id')->nullable()->constrained('device_adapters')->restrictOnDelete();
            $table->string('cause', 32)->nullable();
            $table->timestampTz('offline_since')->nullable();
            $table->timestampTz('last_seen_at')->nullable();
            $table->timestampTz('last_observed_at')->nullable();
            $table->timestampTz('suppressed_at')->nullable();
            $table->unsignedInteger('threshold_seconds')->nullable();
            $table->unsignedInteger('grace_seconds')->nullable();
            $table->unsignedInteger('reporting_interval_seconds')->nullable();
            $table->unsignedInteger('poll_interval_seconds')->nullable();
            $table->boolean('threshold_automatic')->nullable();
            $table->string('stopped_reason', 64)->nullable();
            $table->boolean('held')->default(false);
            $table->unsignedInteger('held_count')->default(0);
        });

        // A workflow alert always has its workflow and deployment; no other kind has either.
        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE automation_alerts ADD CONSTRAINT automation_alerts_kind_check CHECK (CASE WHEN kind = 'workflow' THEN automation_workflow_id IS NOT NULL AND automation_deployment_id IS NOT NULL ELSE automation_workflow_id IS NULL AND automation_deployment_id IS NULL END)");
        }

        Schema::create('automation_alert_devices', function (Blueprint $table): void {
            $table->foreignId('automation_alert_id')->constrained()->restrictOnDelete();
            $table->foreignId('device_id')->constrained()->restrictOnDelete();
            $table->primary(['automation_alert_id', 'device_id']);
            $table->index(['device_id', 'automation_alert_id']);
        });

        // The bound device of each workflow alert's execution snapshot, as AlertQuery reads it.
        $grammar = DB::connection()->getQueryGrammar();
        $bound = 'coalesce('.$grammar->wrap('automation_deployments.definition->binding->device_uuid').', '.$grammar->wrap('automation_deployments.definition->bindings[0]->device_uuid').')';
        DB::table('automation_alert_devices')->insertUsing(['automation_alert_id', 'device_id'], DB::table('automation_alerts')
            ->join('automation_deployments', 'automation_deployments.id', '=', 'automation_alerts.automation_deployment_id')
            ->join('devices', fn ($join) => $join->on('devices.organization_id', '=', 'automation_alerts.organization_id')->whereRaw('cast(devices.uuid as text) = '.$bound))
            ->select(['automation_alerts.id', 'devices.id']));

        Schema::table('automation_alert_deliveries', function (Blueprint $table): void {
            $table->string('channel', 32)->default('email')->after('type');
        });
        Schema::table('automation_alert_deliveries', function (Blueprint $table): void {
            $table->dropUnique('alert_delivery_unique');
            $table->unique(['automation_alert_id', 'recipient_id', 'type', 'channel'], 'alert_delivery_unique');
        });
    }

    public function down(): void
    {
        // What the old schema cannot hold: other kinds of alerts and deliveries on other channels.
        $other = DB::table('automation_alerts')->where('kind', '!=', 'workflow')->pluck('id');
        $deliveries = DB::table('automation_alert_deliveries')->whereIn('automation_alert_id', $other)->orWhere('channel', '!=', 'email')->pluck('id');
        DB::table('automation_alert_delivery_attempts')->whereIn('automation_alert_delivery_id', $deliveries)->delete();
        DB::table('automation_alert_deliveries')->whereIn('id', $deliveries)->delete();
        DB::table('automation_alert_comments')->whereIn('automation_alert_id', $other)->delete();

        Schema::table('automation_alert_deliveries', function (Blueprint $table): void {
            $table->dropUnique('alert_delivery_unique');
            $table->unique(['automation_alert_id', 'recipient_id', 'type'], 'alert_delivery_unique');
        });
        Schema::table('automation_alert_deliveries', fn (Blueprint $table) => $table->dropColumn('channel'));
        Schema::dropIfExists('automation_alert_devices');
        DB::table('automation_alerts')->whereIn('id', $other)->delete();

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE automation_alerts DROP CONSTRAINT automation_alerts_kind_check');
        }

        Schema::table('automation_alerts', function (Blueprint $table): void {
            $table->dropUnique(['episode_key']);
            $table->dropConstrainedForeignId('subject_device_id');
            $table->dropConstrainedForeignId('subject_gateway_id');
            $table->dropConstrainedForeignId('subject_adapter_id');
            $table->dropColumn(['kind', 'severity', 'episode_key', 'cause', 'offline_since', 'last_seen_at', 'last_observed_at', 'suppressed_at', 'threshold_seconds', 'grace_seconds', 'reporting_interval_seconds', 'poll_interval_seconds', 'threshold_automatic', 'stopped_reason', 'held', 'held_count']);
        });
        Schema::table('automation_alerts', function (Blueprint $table): void {
            $table->foreignId('automation_workflow_id')->nullable(false)->change();
            $table->foreignId('automation_deployment_id')->nullable(false)->change();
        });
    }
};
