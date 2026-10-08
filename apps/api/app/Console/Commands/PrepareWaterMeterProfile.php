<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Domain\DeviceProfiles\Actions\PublishDeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use App\Support\DemoEnvironment;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

final class PrepareWaterMeterProfile extends Command
{
    protected $signature = 'devices:prepare-water-meter-profile {--organization=acme-manufacturing}';

    protected $description = 'Add a published water-meter example profile without creating a device or MQTT credentials.';

    public function handle(): int
    {
        if (! DemoEnvironment::allowed()) {
            $this->error('This example is restricted to local/testing or explicitly enabled demo environments.');

            return self::FAILURE;
        }
        $organization = Organization::where('slug', $this->option('organization'))->firstOrFail();
        $actor = User::where('is_super_admin', true)->firstOrFail();
        $profile = DB::transaction(function () use ($organization, $actor) {
            Organization::whereKey($organization->id)->lockForUpdate()->firstOrFail();
            $existing = DeviceProfile::withTrashed()->where('organization_id', $organization->id)->where('code', 'water-meter-onboarding-example')->first();
            if ($existing) {
                return $existing;
            }
            $profile = DeviceProfile::create(['organization_id' => $organization->id, 'code' => 'water-meter-onboarding-example', 'name' => 'Water meter (simulator)', 'category' => 'water-metering', 'description' => 'Example water meter: instantaneous flow rate in L/min and cumulative total volume in L. No physical meter is connected.', 'created_by' => $actor->id, 'updated_by' => $actor->id]);
            foreach ([['flow_rate', 'Flow rate', 'measurement', 'L/min'], ['total_volume', 'Total volume', 'counter', 'L']] as $i => [$key, $label, $kind, $unit]) {
                $profile->parameters()->create(['key' => $key, 'label' => $label, 'kind' => $kind, 'data_type' => 'number', 'unit' => $unit, 'reports_state' => true, 'accepts_command' => false, 'display_config' => ['precision' => 3], 'reporting_config' => ['stale_after_seconds' => 15], 'counter_config' => $kind === 'counter' ? ['monotonic' => true, 'reset_behavior' => 'diagnose'] : null, 'sort_order' => $i]);
            }
            app(PublishDeviceProfile::class)->handle($profile->fresh(), $actor, 1);

            return $profile->fresh();
        });
        $this->info('Water-meter profile: '.$profile->uuid.'. Existing profiles are left unchanged. Add the device through the portal.');

        return self::SUCCESS;
    }
}
