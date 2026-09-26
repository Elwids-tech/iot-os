<?php
// Local-only fixture for the independently packaged Node SDK. No hardware actions.
declare(strict_types=1);
use App\Domain\Shared\Models\{Organization, User};
use App\Domain\Devices\Models\Device;
use App\Domain\Automation\Models\{Alert, Workflow, Deployment};
use App\Domain\Integrations\Models\IntegrationApplication;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
require '/var/www/html/vendor/autoload.php';
$app = require '/var/www/html/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!$app->environment('local', 'testing')) { throw new RuntimeException('Local verification only.'); }
$actor = User::where('is_super_admin', true)->firstOrFail();
$token = $actor->createToken('temporary-sdk-verification', ['*'], now()->addMinutes(5));
$org = Organization::create(['name' => 'Temporary SDK check', 'slug' => 'sdk-check-'.Str::uuid()]);
$foreign = Organization::create(['name' => 'Temporary SDK isolation check', 'slug' => 'sdk-foreign-'.Str::uuid()]);
try {
    $devices = [];
    foreach (['one', 'two', 'private'] as $code) {
        $devices[] = Device::create(['organization_id' => $org->id, 'code' => $code, 'name' => 'SDK fixture '.$code, 'presence' => 'online', 'runtime_seen_at' => now()->subMinute()]);
    }
    $telemetry = null;
    if (getenv('IOT_VERIFY_TELEMETRY') === '1') {
        $configuration = (string) Str::uuid(); $parameter = (string) Str::uuid();
        $devices[0]->update(['last_applied_configuration_uuid' => $configuration]);
        $at = now()->subMinutes(2)->startOfSecond();
        $reading = ['parameter_uuid' => $parameter, 'key' => 'temperature', 'label' => 'Temperature', 'data_type' => 'number', 'unit' => '°C', 'value' => 21.5, 'quality' => 'good', 'observed_at' => $at->toIso8601String(), 'received_at' => $at->toIso8601String(), 'timestamp_source' => 'source', 'historical' => false];
        $row = ['organization_uuid' => $org->uuid, 'device_uuid' => $devices[0]->uuid, 'configuration_uuid' => $configuration, 'parameter_uuid' => $parameter, 'received_at' => $at, 'reading' => json_encode($reading, JSON_THROW_ON_ERROR)];
        DB::table('device_runtime.latest')->insert($row);
        DB::table('device_runtime.observations')->insert([...$row, 'event_uuid' => (string) Str::uuid(), 'observed_at' => $at]);
        $telemetry = ['parameter' => $parameter, 'configuration' => $configuration, 'from' => $at->copy()->subMinute()->toIso8601String(), 'to' => $at->copy()->addMinute()->toIso8601String()];
    }
    $workflow = Workflow::create(['organization_id' => $org->id, 'name' => 'SDK fixture boundary', 'workflow' => ['nodes' => [], 'edges' => []], 'definition' => [], 'definition_hash' => str_repeat('a', 64), 'updated_by' => $actor->id]);
    $deployment = Deployment::create(['automation_workflow_id' => $workflow->id, 'created_by' => $actor->id, 'created_at' => now(), 'generation' => 1, 'draft_revision' => 1, 'target' => 'active', 'status' => 'applied', 'definition_hash' => str_repeat('a', 64), 'definition' => ['binding' => ['device_uuid' => $devices[0]->uuid]]]);
    if ($telemetry !== null) {
        $latitude = (string) Str::uuid(); $longitude = (string) Str::uuid();
        $binding = ['schema_version' => 'location-binding.v1', 'uuid' => (string) Str::uuid(), 'revision' => 1, 'organization_uuid' => $org->uuid, 'device_uuid' => $devices[0]->uuid, 'configuration_uuid' => $configuration, 'generation' => 1, 'latitude_parameter_uuid' => $latitude, 'longitude_parameter_uuid' => $longitude, 'accuracy_parameter_uuid' => null, 'pairing' => 'same_event', 'max_age_seconds' => 3600, 'max_future_skew_seconds' => 30, 'allow_unknown_accuracy' => true];
        $definition = ['binding' => $binding, 'geometry' => ['type' => 'Polygon', 'coordinates' => [[[-115, 51], [-113, 51], [-113, 52], [-115, 52], [-115, 51]]]]];
        $locationVersion = Deployment::create(['automation_workflow_id' => $workflow->id, 'created_by' => $actor->id, 'created_at' => now(), 'generation' => 2, 'draft_revision' => 1, 'target' => 'active', 'status' => 'applied', 'definition_hash' => str_repeat('b', 64), 'definition' => $definition]);
        $gpsEvents = [];
        for ($index = 0; $index < 3; $index++) {
            $eventID = (string) Str::uuid(); $gpsEvents[] = $eventID;
            $readings = [];
            foreach ([$latitude => 51.5, $longitude => -114.1] as $parameterID => $value) {
                if ($index === 2 && $parameterID === $longitude) { continue; }
                $gpsReading = [...$reading, 'parameter_uuid' => $parameterID, 'key' => $parameterID === $latitude ? 'latitude' : 'longitude', 'unit' => 'deg', 'value' => $value];
                $readings[] = $gpsReading;
                DB::table('device_runtime.observations')->insert([...$row, 'parameter_uuid' => $parameterID, 'event_uuid' => $eventID, 'observed_at' => $at, 'reading' => json_encode($gpsReading, JSON_THROW_ON_ERROR)]);
            }
            $event = ['schema_version' => 'telemetry.committed.v1', 'event_id' => $eventID, 'telemetry_id' => $eventID, 'sequence' => '', 'organization_uuid' => $org->uuid, 'device_uuid' => $devices[0]->uuid, 'configuration_uuid' => $configuration, 'generation' => 1, 'readings' => $readings];
            // Already published fixture rows never enter the live broker or rules pipeline.
            DB::table('device_runtime.telemetry_outbox')->insert(['telemetry_uuid' => $eventID, 'organization_uuid' => $org->uuid, 'event' => json_encode($event, JSON_THROW_ON_ERROR), 'created_at' => $at, 'published_at' => now()]);
        }
        if (getenv('IOT_VERIFY_DASHBOARD') === '1') {
            $workflow->update(['applied_deployment_uuid' => $locationVersion->uuid, 'deployment_status' => 'applied']);
            // Disabled fixture proves stored reads without executing rules or emitting actions.
            DB::table('device_runtime.rule_executions')->insert([
                'operation_uuid' => $locationVersion->uuid, 'rule_uuid' => $workflow->uuid,
                'organization_uuid' => $org->uuid, 'device_uuid' => $devices[0]->uuid,
                'definition' => json_encode($definition, JSON_THROW_ON_ERROR), 'definition_hash' => str_repeat('b', 64),
                'state' => json_encode(['condition' => 'unknown', 'active' => false, 'last_event_id' => end($gpsEvents), 'expires_at' => null]),
                'enabled' => false, 'stopped_reason' => 'Verification fixture is stopped', 'started_at' => now(), 'updated_at' => now(),
            ]);
        }
        $telemetry += ['latitude' => $latitude, 'events' => $gpsEvents, 'version' => $locationVersion->uuid];
    }
    $alert = Alert::create(['organization_id' => $org->id, 'automation_workflow_id' => $workflow->id, 'automation_deployment_id' => $deployment->id, 'episode' => 1, 'activated_at' => now()]);
    @unlink('/tmp/iot-sdk-release');
    file_put_contents('/tmp/iot-sdk-fixture.json', json_encode(['organization' => $org->uuid, 'foreign' => $foreign->uuid, 'devices' => array_map(fn ($d) => $d->uuid, $devices), 'alert' => $alert->uuid, 'workflow' => $workflow->uuid, 'adminToken' => $token->plainTextToken, 'telemetry' => $telemetry], JSON_THROW_ON_ERROR));
    chmod('/tmp/iot-sdk-fixture.json', 0600);
    echo "SDK fixture ready for isolated HTTP client.\n";
    $until = microtime(true) + 180;
    while (!file_exists('/tmp/iot-sdk-release') && microtime(true) < $until) { usleep(250000); }
    if (!file_exists('/tmp/iot-sdk-release')) { throw new RuntimeException('SDK verification timed out.'); }
} finally {
    foreach (IntegrationApplication::where('organization_id', $org->id)->get() as $application) {
        $hooks = DB::table('integration_webhooks')->where('integration_application_id', $application->id)->pluck('id');
        $deliveries = DB::table('integration_webhook_deliveries')->whereIn('integration_webhook_id', $hooks)->pluck('id');
        DB::table('integration_webhook_attempts')->whereIn('integration_webhook_delivery_id', $deliveries)->delete();
        DB::table('integration_webhook_deliveries')->whereIn('id', $deliveries)->delete();
        DB::table('integration_webhooks')->whereIn('id', $hooks)->delete();
        $application->tokens()->delete(); $application->delete();
    }
    DB::table('dashboards')->where('organization_id', $org->id)->delete();
    DB::table('device_runtime.rule_executions')->where('organization_uuid', $org->uuid)->delete();
    DB::table('automation_alerts')->where('organization_id', $org->id)->delete();
    $workflows = Workflow::where('organization_id', $org->id)->pluck('id');
    Deployment::whereIn('automation_workflow_id', $workflows)->delete();
    Workflow::where('organization_id', $org->id)->delete();
    if (getenv('IOT_VERIFY_TELEMETRY') === '1') {
        DB::table('device_runtime.telemetry_outbox')->where('organization_uuid', $org->uuid)->delete();
        DB::table('device_runtime.latest')->where('organization_uuid', $org->uuid)->delete();
        DB::table('device_runtime.observations')->where('organization_uuid', $org->uuid)->delete();
    }
    Device::where('organization_id', $org->id)->delete();
    DB::table('device_audit_events')->where('organization_id', $org->id)->delete();
    $token->accessToken->delete();
    DB::table('integration_events')->where('organization_id', $org->id)->delete();
    DB::table('integration_streams')->where('organization_id', $org->id)->delete();
    $org->forceDelete(); $foreign->forceDelete();
    @unlink('/tmp/iot-sdk-fixture.json'); @unlink('/tmp/iot-sdk-release');
    echo "Temporary SDK records removed.\n";
}
