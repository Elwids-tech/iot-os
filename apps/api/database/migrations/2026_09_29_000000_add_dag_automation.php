<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Spatie\Permission\PermissionRegistrar;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('automation_workflows', function (Blueprint $t): void {
            $t->json('layout')->nullable();
            $t->unsignedInteger('layout_revision')->default(0);
        });
        Schema::table('automation_deployments', function (Blueprint $t): void {
            $t->json('command_grants')->nullable();
        });
        Schema::create('automation_settings', function (Blueprint $t): void {
            $t->foreignId('organization_id')->primary()->constrained()->cascadeOnDelete();
            $t->boolean('enabled')->default(false);
            $t->boolean('stopped')->default(false);
            $t->unsignedInteger('revision')->default(0);
        });
        Schema::create('automation_actions', function (Blueprint $t): void {
            $t->string('id', 64)->primary();
            $t->foreignId('organization_id')->constrained()->restrictOnDelete();
            $t->foreignId('automation_deployment_id')->constrained()->restrictOnDelete();
            $t->string('node_id', 64);
            $t->string('kind');
            $t->string('status')->default('accepted')->index();
            $t->json('intent');
            $t->uuid('command_uuid')->nullable();
            $t->text('diagnostic')->nullable();
            $t->timestampTz('expires_at');
            $t->timestampsTz();
        });
        Schema::create('automation_command_targets', function (Blueprint $t): void {
            $t->foreignId('device_id')->constrained()->restrictOnDelete();
            $t->uuid('parameter_uuid');
            $t->primary(['device_id', 'parameter_uuid']);
            $t->timestampTz('last_sent_at')->nullable();
            $t->timestampTz('minute_start')->nullable();
            $t->unsignedInteger('minute_count')->default(0);
            $t->uuid('uncertain_command_uuid')->nullable();
        });
        Schema::create('automation_command_reconciliations', function (Blueprint $t): void {
            $t->uuid('command_uuid')->primary();
            $t->foreignId('user_id')->constrained()->restrictOnDelete();
            $t->text('note');
            $t->timestampTz('created_at');
        });
        // Copy effective role/direct grants, including custom roles and team IDs.
        // Device.command is deliberately excluded.
        foreach (['view', 'manage', 'activate'] as $name) {
            $new = DB::table('permissions')->insertGetId(['name' => 'Workflow.'.$name, 'guard_name' => 'web', 'group' => 'Workflow', 'created_at' => now(), 'updated_at' => now()]);
            $old = DB::table('permissions')->where('name', 'Device.'.$name)->where('guard_name', 'web')->value('id');
            if (! $old) {
                continue;
            }
            foreach (['role_has_permissions', 'model_has_permissions'] as $table) {
                foreach (DB::table($table)->where('permission_id', $old)->get() as $row) {
                    $copy = (array) $row;
                    $copy['permission_id'] = $new;
                    DB::table($table)->insertOrIgnore($copy);
                }
            }
        }
        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }

    public function down(): void
    {
        Schema::dropIfExists('automation_command_reconciliations');
        Schema::dropIfExists('automation_command_targets');
        Schema::dropIfExists('automation_actions');
        Schema::dropIfExists('automation_settings');
        Schema::table('automation_deployments', fn (Blueprint $t) => $t->dropColumn('command_grants'));
        Schema::table('automation_workflows', fn (Blueprint $t) => $t->dropColumn(['layout', 'layout_revision']));
        DB::table('permissions')->whereIn('name', ['Workflow.view', 'Workflow.manage', 'Workflow.activate'])->delete();
    }
};
