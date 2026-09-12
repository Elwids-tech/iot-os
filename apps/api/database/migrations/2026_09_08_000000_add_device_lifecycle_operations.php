<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('devices', function (Blueprint $table): void {
            $table->uuid('last_applied_configuration_uuid')->nullable();
            $table->unsignedBigInteger('state_revision')->default(0);
        });
        Schema::create('device_operations', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('device_id')->constrained('devices');
            $table->foreignId('actor_id')->nullable()->constrained('users');
            $table->string('target_state');
            $table->string('kind');
            $table->unsignedInteger('expected_generation');
            $table->unsignedInteger('generation');
            $table->uuid('configuration_uuid')->nullable();
            $table->string('status')->default('pending');
            $table->string('outstanding_key')->nullable()->unique();
            $table->text('diagnostic')->nullable();
            $table->timestampTz('created_at');
            $table->timestampTz('completed_at')->nullable();
            $table->unique(['device_id', 'generation']);
        });
        DB::table('devices')->orderBy('id')->chunkById(100, function ($devices): void {
            foreach ($devices as $device) {
                $last = $device->applied_configuration_uuid;
                if (! $last) {
                    $acks = DB::table('device_audit_events')->where('resource_uuid', $device->uuid)
                        ->where('action', 'device.applied.v1')->orderByDesc('id')->get();
                    foreach ($acks as $ack) {
                        $generation = json_decode($ack->details, true)['generation'] ?? null;
                        foreach (DB::table('device_outbox')->where('type', 'device.activate.v1')->where('payload->device_uuid', $device->uuid)->orderByDesc('id')->cursor() as $event) {
                            $payload = json_decode($event->payload, true);
                            if (($payload['device_uuid'] ?? null) === $device->uuid && ($payload['generation'] ?? null) === $generation) {
                                $candidate = $payload['definition']['configuration_uuid'] ?? null;
                                if (DB::table('device_configurations')->where('device_id', $device->id)->where('uuid', $candidate)->exists()) {
                                    $last = $candidate;
                                }
                                break;
                            }
                        }
                        if ($last) {
                            break;
                        }
                    }
                }
                DB::table('devices')->where('id', $device->id)->update(['last_applied_configuration_uuid' => $last]);
                if ($device->deployment_status === 'pending') {
                    DB::table('device_operations')->insert([
                        'uuid' => (string) Str::uuid(), 'device_id' => $device->id, 'actor_id' => null,
                        'target_state' => $device->desired_configuration_uuid ? 'active' : 'inactive', 'kind' => 'legacy',
                        'expected_generation' => max(0, $device->deployment_generation - 1), 'generation' => $device->deployment_generation,
                        'configuration_uuid' => $device->desired_configuration_uuid, 'status' => 'pending',
                        'outstanding_key' => $device->uuid, 'created_at' => now(),
                    ]);
                }
            }
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('device_operations');
        Schema::table('devices', fn (Blueprint $table) => $table->dropColumn(['last_applied_configuration_uuid', 'state_revision']));
    }
};
