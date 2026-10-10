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

final class PrepareEnvironmentSensorProfile extends Command
{
    protected $signature = 'devices:prepare-environment-sensor-profile {--organization=acme-manufacturing}';

    protected $description = 'Add a published vendor temperature/humidity sensor profile for adapter demos, without creating a device or credentials.';

    /** Key, label, kind, unit, precision: matches tooling/simulators/vendor_env_sensor.py after decoding. */
    private const PARAMETERS = [
        ['temperature', 'Temperature', 'measurement', '°C', 1],
        ['humidity', 'Relative humidity', 'measurement', '%', 1],
        ['rssi', 'Signal strength', 'measurement', 'dBm', 0],
        ['snr', 'Signal-to-noise ratio', 'measurement', 'dB', 1],
        ['battery_voltage', 'Battery voltage', 'measurement', 'V', 2],
        ['uptime', 'Uptime', 'counter', 's', 0],
    ];

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
            $existing = DeviceProfile::withTrashed()->where('organization_id', $organization->id)->where('code', 'vendor-environment-sensor-example')->first();
            if ($existing) {
                return $existing;
            }
            $profile = DeviceProfile::create(['organization_id' => $organization->id, 'code' => 'vendor-environment-sensor-example', 'name' => 'Environmental sensor (vendor JSON)', 'category' => 'environmental-sensors', 'description' => 'Example off-the-shelf MQTT sensor reporting temperature and humidity with radio and battery diagnostics in its own JSON format.', 'created_by' => $actor->id, 'updated_by' => $actor->id]);
            foreach (self::PARAMETERS as $i => [$key, $label, $kind, $unit, $precision]) {
                $profile->parameters()->create(['key' => $key, 'label' => $label, 'kind' => $kind, 'data_type' => 'number', 'unit' => $unit, 'reports_state' => true, 'accepts_command' => false, 'display_config' => ['precision' => $precision], 'reporting_config' => ['stale_after_seconds' => 120], 'counter_config' => $kind === 'counter' ? ['monotonic' => true, 'reset_behavior' => 'diagnose'] : null, 'sort_order' => $i]);
            }
            app(PublishDeviceProfile::class)->handle($profile->fresh(), $actor, 1);

            return $profile->fresh();
        });
        $this->info('Environmental sensor profile: '.$profile->uuid.'. Existing profiles are left unchanged. Connect the device through Device adapters.');

        return self::SUCCESS;
    }
}
