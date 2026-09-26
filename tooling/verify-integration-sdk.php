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
    $workflow = Workflow::create(['organization_id' => $org->id, 'name' => 'SDK fixture boundary', 'workflow' => [], 'definition' => [], 'definition_hash' => str_repeat('a', 64), 'updated_by' => $actor->id]);
    $deployment = Deployment::create(['automation_workflow_id' => $workflow->id, 'created_by' => $actor->id, 'created_at' => now(), 'generation' => 1, 'draft_revision' => 1, 'target' => 'active', 'status' => 'applied', 'definition_hash' => str_repeat('a', 64), 'definition' => ['binding' => ['device_uuid' => $devices[0]->uuid]]]);
    $alert = Alert::create(['organization_id' => $org->id, 'automation_workflow_id' => $workflow->id, 'automation_deployment_id' => $deployment->id, 'episode' => 1, 'activated_at' => now()]);
    @unlink('/tmp/iot-sdk-release');
    file_put_contents('/tmp/iot-sdk-fixture.json', json_encode(['organization' => $org->uuid, 'foreign' => $foreign->uuid, 'devices' => array_map(fn ($d) => $d->uuid, $devices), 'alert' => $alert->uuid, 'adminToken' => $token->plainTextToken], JSON_THROW_ON_ERROR));
    chmod('/tmp/iot-sdk-fixture.json', 0600);
    echo "SDK fixture ready for isolated HTTP client.\n";
    $until = microtime(true) + 180;
    while (!file_exists('/tmp/iot-sdk-release') && microtime(true) < $until) { usleep(250000); }
    if (!file_exists('/tmp/iot-sdk-release')) { throw new RuntimeException('SDK verification timed out.'); }
} finally {
    foreach (IntegrationApplication::where('organization_id', $org->id)->get() as $application) { $application->tokens()->delete(); $application->delete(); }
    DB::table('automation_alerts')->where('organization_id', $org->id)->delete();
    $workflows = Workflow::where('organization_id', $org->id)->pluck('id');
    Deployment::whereIn('automation_workflow_id', $workflows)->delete();
    Workflow::where('organization_id', $org->id)->delete();
    Device::where('organization_id', $org->id)->delete();
    DB::table('device_audit_events')->where('organization_id', $org->id)->delete();
    $token->accessToken->delete();
    DB::table('integration_events')->where('organization_id', $org->id)->delete();
    DB::table('integration_streams')->where('organization_id', $org->id)->delete();
    $org->forceDelete(); $foreign->forceDelete();
    @unlink('/tmp/iot-sdk-fixture.json'); @unlink('/tmp/iot-sdk-release');
    echo "Temporary SDK records removed.\n";
}
