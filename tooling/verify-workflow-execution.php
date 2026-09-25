<?php

// Local-only integration fixture. Run in the rebuilt API container:
// rtk proxy docker exec -i iot-os-dev-api-1 php < tooling/verify-workflow-execution.php
// Creates a temporary organization and synthetic device; never controls hardware.
declare(strict_types=1);

use App\Domain\Automation\Models\Deployment;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceConfiguration;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Contracts\Http\Kernel;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

require '/var/www/html/vendor/autoload.php';
$app = require '/var/www/html/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
set_exception_handler(static function (Throwable $error): void {
    file_put_contents('php://stderr', 'FAIL '.$error->getMessage().PHP_EOL);
    exit(1);
});
if (! $app->environment('local', 'testing')) { throw new RuntimeException('Local verification only.'); }
$check = static function (bool $condition, string $message): void {
    if (! $condition) { throw new RuntimeException($message); }
};
$actor = User::where('is_super_admin', true)->firstOrFail();
$access = $actor->createToken('temporary-workflow-execution-check');
$org = Organization::create(['name' => 'Temporary workflow execution check', 'slug' => 'workflow-check-'.Str::uuid()]);
$eventIds = [];
$call = static function (string $method, string $url, array $body = [], int $status = 200) use ($app, $access, $check): array {
    Auth::forgetGuards();
    $request = Request::create($url, $method, [], [], [], ['HTTP_ACCEPT' => 'application/json', 'CONTENT_TYPE' => 'application/json', 'HTTP_AUTHORIZATION' => 'Bearer '.$access->plainTextToken], json_encode($body, JSON_THROW_ON_ERROR));
    $kernel = $app->make(Kernel::class);
    $response = $kernel->handle($request);
    $kernel->terminate($request, $response);
    $check($response->getStatusCode() === $status, $method.' '.$url.' returned '.$response->getStatusCode().': '.$response->getContent());
    return json_decode($response->getContent(), true, 512, JSON_THROW_ON_ERROR);
};
$wait = static function (callable $predicate, string $message): void {
    $deadline = microtime(true) + 40;
    do {
        if ($predicate()) { return; }
        usleep(250000);
    } while (microtime(true) < $deadline);
    throw new RuntimeException($message);
};
try {
    $graph = json_decode(file_get_contents('/var/contracts/rules/v1/workflow.fixture.json'), true, 512, JSON_THROW_ON_ERROR);
    $binding = $graph['nodes'][0]['config']['binding'];
    $parameters = [];
    foreach (['latitude' => 'deg', 'longitude' => 'deg', 'accuracy' => 'm'] as $key => $unit) {
        $parameters[] = ['uuid' => $binding[$key.'_parameter_uuid'], 'key' => $key, 'label' => $key, 'kind' => 'measurement', 'data_type' => 'number', 'reports_state' => true, 'accepts_command' => false, 'unit' => $unit];
    }
    $canonical = json_encode(['schema_version' => 'device-profile.v1', 'parameters' => $parameters, 'calculations' => []], JSON_THROW_ON_ERROR);
    $profile = DeviceProfile::create(['organization_id' => $org->id, 'code' => 'temporary-gps', 'name' => 'Temporary GPS']);
    $artifact = DeviceProfileArtifact::create(['device_profile_id' => $profile->id, 'revision' => 1, 'definition' => json_decode($canonical, true), 'definition_hash' => hash('sha256', $canonical), 'status' => 'active', 'compiled_at' => now(), 'compiled_by' => $actor->id]);
    $device = Device::create(['organization_id' => $org->id, 'name' => 'Synthetic verification tag', 'code' => 'synthetic-tag', 'lifecycle' => 'active', 'deployment_status' => 'applied', 'deployment_generation' => 1]);
    $configurationUuid = (string) Str::uuid();
    $definition = ['schema_version' => 'device-configuration.v1', 'organization_uuid' => $org->uuid, 'device_uuid' => $device->uuid, 'configuration_uuid' => $configurationUuid, 'profile_artifact_uuid' => $artifact->uuid, 'profile_hash' => hash('sha256', $canonical), 'profile_canonical_json' => $canonical, 'mappings' => array_map(fn ($p) => ['parameter_uuid' => $p['uuid'], 'metric' => $p['key'], 'datatype' => 'Double'], $parameters)];
    DeviceConfiguration::create(['uuid' => $configurationUuid, 'device_id' => $device->id, 'device_profile_artifact_id' => $artifact->id, 'revision' => 1, 'definition' => $definition, 'definition_hash' => hash('sha256', json_encode($definition)), 'created_at' => now()]);
    $device->update(['applied_configuration_uuid' => $configurationUuid]);
    DB::table('device_runtime.devices')->insert(['device_uuid' => $device->uuid, 'organization_uuid' => $org->uuid, 'generation' => 1, 'definition' => json_encode($definition, JSON_THROW_ON_ERROR)]);
    $binding = [...$binding, 'organization_uuid' => $org->uuid, 'device_uuid' => $device->uuid, 'configuration_uuid' => $configurationUuid];
    $graph['nodes'][0]['config']['binding'] = $binding;
    $graph['nodes'][2]['config']['outside_for_seconds'] = 0;
    $graph['nodes'][2]['config']['minimum_samples'] = 1;
    $base = '/api/v1/organizations/'.$org->uuid.'/workflows';
    $draft = $call('POST', $base, ['name' => 'Temporary boundary', 'workflow' => $graph], 201)['data'];
    $url = $base.'/'.$draft['uuid'];
    $operation = (string) Str::uuid();
    $request = ['operation_uuid' => $operation, 'draft_revision' => 1, 'expected_generation' => 0, 'target_state' => 'active'];
    $call('POST', $url.'/deployments', $request, 202);
    $call('POST', $url.'/deployments', $request, 202);
    $wait(fn () => $call('GET', $url)['data']['deployment_status'] === 'applied', 'Activation was not acknowledged.');
    $check($call('GET', $url.'/execution')['data']['enabled'], 'Execution was not enabled.');
    $emit = static function (float $longitude) use ($org, $device, $configurationUuid, $parameters, &$eventIds): void {
        $id = (string) Str::uuid();
        $eventIds[] = $id;
        $at = now()->utc()->format('Y-m-d\TH:i:s.u\Z');
        $readings = [];
        foreach ($parameters as $i => $parameter) {
            $readings[] = ['parameter_uuid' => $parameter['uuid'], 'key' => $parameter['key'], 'data_type' => 'number', 'unit' => $parameter['unit'], 'value' => [51, $longitude, 0][$i], 'quality' => 'good', 'timestamp_source' => 'source', 'observed_at' => $at, 'received_at' => $at, 'historical' => false];
        }
        $event = ['schema_version' => 'telemetry.committed.v1', 'event_id' => $id, 'telemetry_id' => $id, 'sequence' => '1', 'organization_uuid' => $org->uuid, 'device_uuid' => $device->uuid, 'configuration_uuid' => $configurationUuid, 'generation' => 1, 'readings' => $readings];
        DB::table('device_runtime.telemetry_outbox')->insert(['telemetry_uuid' => $id, 'organization_uuid' => $org->uuid, 'event' => json_encode($event, JSON_THROW_ON_ERROR)]);
    };
    $emit(-114.02);
    $wait(fn () => $call('GET', $url.'/transitions')['meta']['total'] === 1, 'Outside transition was not delivered.');
    $check($call('GET', $url.'/execution')['data']['state']['active'], 'Outside state was not persisted.');
    $emit(-114);
    $wait(fn () => $call('GET', $url.'/transitions')['meta']['total'] === 2, 'Inside clear was not delivered.');
    $check(! $call('GET', $url.'/execution')['data']['state']['active'], 'Inside state did not clear.');
    $disable = ['operation_uuid' => (string) Str::uuid(), 'draft_revision' => 1, 'expected_generation' => 1, 'target_state' => 'inactive'];
    $call('POST', $url.'/deployments', $disable, 202);
    $wait(fn () => $call('GET', $url)['data']['deployment_status'] === 'inactive', 'Disable was not acknowledged.');
    $check($call('GET', $url.'/transitions')['meta']['total'] === 2, 'Disable invented a clear transition.');
    echo "PASS real activation acknowledgement, retry, committed outbox → broker → durable evaluation → API transitions, execution reads and disable\n";
} finally {
    // Only UUIDs belonging to the temporary organization are removed. Keep the
    // global stream checkpoint: it must never be reset for a verification run.
    DB::transaction(function () use ($org, $eventIds, $access): void {
        $workflows = DB::table('automation_workflows')->where('organization_id', $org->id)->pluck('id');
        $deployments = Deployment::whereIn('automation_workflow_id', $workflows)->pluck('id');
        $operations = Deployment::whereIn('id', $deployments)->pluck('uuid');
        $runtimeEvents = DB::table('device_runtime.outbox')->whereRaw("event->'payload'->>'organization_uuid' = ?", [$org->uuid])->pluck('uuid');
        DB::table('device_inbox')->whereIn('uuid', $runtimeEvents)->delete();
        DB::table('device_runtime.outbox')->whereIn('uuid', $runtimeEvents)->delete();
        DB::table('device_runtime.rule_transitions')->whereIn('operation_uuid', $operations)->delete();
        foreach (['rule_executions', 'rule_heads', 'telemetry_outbox', 'devices'] as $table) { DB::table('device_runtime.'.$table)->where('organization_uuid', $org->uuid)->delete(); }
        DB::table('device_runtime.rule_inputs')->whereIn('event_uuid', $eventIds)->delete();
        DB::table('automation_transitions')->whereIn('automation_deployment_id', $deployments)->delete();
        DB::table('automation_deployments')->whereIn('id', $deployments)->delete();
        DB::table('automation_workflow_revisions')->whereIn('automation_workflow_id', $workflows)->delete();
        DB::table('automation_workflows')->whereIn('id', $workflows)->delete();
        DB::table('device_outbox')->whereRaw("payload->>'organization_uuid' = ?", [$org->uuid])->delete();
        DB::table('device_audit_events')->where('organization_id', $org->id)->delete();
        $devices = DB::table('devices')->where('organization_id', $org->id)->pluck('id');
        DB::table('device_configurations')->whereIn('device_id', $devices)->delete();
        DB::table('devices')->whereIn('id', $devices)->delete();
        $profiles = DB::table('device_profiles')->where('organization_id', $org->id)->pluck('id');
        DB::table('device_profile_artifacts')->whereIn('device_profile_id', $profiles)->delete();
        DB::table('device_profiles')->whereIn('id', $profiles)->delete();
        DB::table('organizations')->where('id', $org->id)->delete();
        $access->accessToken->delete();
    });
    echo "Temporary verification records removed; global checkpoint preserved.\n";
}
