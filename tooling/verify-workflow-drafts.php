<?php

// Run inside the rebuilt local API container:
// rtk proxy docker exec -i iot-os-dev-api-1 php < tooling/verify-workflow-drafts.php
// All database changes are rolled back; outbound calls use the real Go runtime.
declare(strict_types=1);

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
if (! $app->environment('local', 'testing')) {
    throw new RuntimeException('This verification is for a local/test API container only.');
}
$check = static function (bool $condition, string $message): void {
    if (! $condition) {
        throw new RuntimeException($message);
    }
};
$fixture = static fn (string $file): array => json_decode(file_get_contents('/var/contracts/rules/v1/'.$file), true, 512, JSON_THROW_ON_ERROR);
$before = DB::table('automation_workflows')->count();
DB::beginTransaction();
try {
    $org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
    $actor = User::where('is_super_admin', true)->firstOrFail();
    $token = $actor->createToken('temporary-workflow-verification')->plainTextToken;
    $call = static function (string $method, string $path, array $body, int $expected, bool $authenticated = true) use ($app, $token, $check): array {
        Auth::forgetGuards();
        $server = ['HTTP_ACCEPT' => 'application/json', 'CONTENT_TYPE' => 'application/json'];
        if ($authenticated) {
            $server['HTTP_AUTHORIZATION'] = 'Bearer '.$token;
        }
        $request = Request::create($path, $method, [], [], [], $server, json_encode($body, JSON_THROW_ON_ERROR));
        $kernel = $app->make(Kernel::class);
        $response = $kernel->handle($request);
        $kernel->terminate($request, $response);
        $check($response->getStatusCode() === $expected, $method.' '.$path.' returned '.$response->getStatusCode().': '.$response->getContent());

        return json_decode($response->getContent(), true, 512, JSON_THROW_ON_ERROR);
    };
    $suffix = (string) Str::uuid();
    $device = Device::create(['organization_id' => $org->id, 'name' => 'Temporary workflow verification', 'code' => $suffix]);
    $profile = DeviceProfile::create(['organization_id' => $org->id, 'code' => $suffix, 'name' => 'Temporary GPS profile']);
    $artifact = DeviceProfileArtifact::create(['device_profile_id' => $profile->id, 'revision' => 1, 'definition' => [], 'definition_hash' => str_repeat('a', 64), 'status' => 'active', 'compiled_at' => now(), 'compiled_by' => $actor->id]);
    $configuration = DeviceConfiguration::create(['device_id' => $device->id, 'device_profile_artifact_id' => $artifact->id, 'revision' => 1, 'definition_hash' => str_repeat('b', 64), 'definition' => [], 'created_at' => now()]);
    $graph = $fixture('workflow.fixture.json');
    $binding = &$graph['nodes'][0]['config']['binding'];
    $binding['organization_uuid'] = $org->uuid;
    $binding['device_uuid'] = $device->uuid;
    $binding['configuration_uuid'] = $configuration->uuid;
    $base = '/api/v1/organizations/'.$org->uuid.'/workflows';
    $call('GET', $base, [], 401, false);
    $check(count($call('GET', $base.'/node-types', [], 200)['data']) === 4, 'registry mismatch');
    $malformed = $graph;
    $malformed['nodes'][0]['config']['binding']['device_uuid'] = 'invalid';
    $call('POST', $base, ['name' => 'Malformed binding', 'workflow' => $malformed], 422);
    $draft = $call('POST', $base, ['name' => 'Temporary paddock', 'workflow' => $graph], 201)['data'];
    $url = $base.'/'.$draft['uuid'];
    $check($call('GET', $url, [], 200)['data']['status'] === 'draft', 'draft status');
    $steps = $fixture('simulation.fixture.json')['steps'];
    foreach ($steps as &$step) {
        if (($step['event'] ?? null) !== null) {
            foreach (['organization_uuid', 'device_uuid', 'configuration_uuid'] as $key) {
                $step['event'][$key] = $binding[$key];
            }
        }
    }
    unset($step);
    $outboxBefore = DB::table('device_outbox')->count();
    $result = $call('POST', $url.'/simulate', ['draft_revision' => 1, 'steps' => $steps], 200);
    $expected = $fixture('simulation.expected.json');
    $check(count($result['results']) === count($expected), 'simulation length mismatch');
    foreach ($expected as $i => $want) {
        $actual = $result['results'][$i];
        foreach (['condition', 'active'] as $key) {
            $check($actual['state'][$key] === $want[$key], 'state mismatch at step '.$i);
        }
        $check($actual['reason'] === $want['reason'], 'reason mismatch at step '.$i);
        $check(($actual['transition']['type'] ?? null) === $want['transition'], 'transition mismatch at step '.$i);
    }
    $bad = $graph;
    $bad['edges'][2]['target'] = '0';
    $call('PUT', $url, ['name' => 'Invalid', 'workflow' => $bad, 'draft_revision' => 1], 422);
    $updated = $call('PUT', $url, ['name' => 'Revised', 'workflow' => $draft['workflow'], 'draft_revision' => 1], 200)['data'];
    $check($updated['draft_revision'] === 2, 'revision did not advance');
    $call('PUT', $url, ['name' => 'Stale', 'workflow' => $graph, 'draft_revision' => 1], 409);
    $call('POST', $url.'/simulate', ['draft_revision' => 1, 'steps' => $steps], 409);
    $other = Organization::where('id', '!=', $org->id)->firstOrFail();
    $call('GET', '/api/v1/organizations/'.$other->uuid.'/workflows/'.$draft['uuid'], [], 404);
    $check(DB::table('device_outbox')->count() === $outboxBefore, 'draft operations emitted live control events');
    echo "PASS real API/runtime draft create/read/update, 13 simulation steps, graph/binding rejection, auth, tenant isolation, stale revisions and no live control events\n";
} finally {
    DB::rollBack();
}
$check(DB::table('automation_workflows')->count() === $before, 'verification did not roll back');
echo "PASS temporary verification records and token rolled back\n";
