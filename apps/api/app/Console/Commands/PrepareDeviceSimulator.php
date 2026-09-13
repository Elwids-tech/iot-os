<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Domain\DeviceProfiles\Actions\PublishDeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\Devices\Models\SparkplugConnection;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Devices\Services\BrokerProvisioner;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class PrepareDeviceSimulator extends Command
{
    protected $signature = 'devices:prepare-simulator {--organization=acme-manufacturing} {--output=} {--broker=ssl://localhost:8883} {--ca=} {--rgb-controls : Prepare a separate RGB v2 profile and gateway}';

    protected $description = 'Create additive local simulator profiles and write private gateway credentials to a file.';

    public function handle(): int
    {
        if (! app()->environment(['local', 'testing'])) {
            $this->error('Simulator setup is restricted to local and testing environments.');

            return self::FAILURE;
        }
        if (! $this->option('output') || ! $this->option('ca')) {
            $this->error('Provide --output and --ca absolute file paths.');

            return self::FAILURE;
        }
        $organization = Organization::where('slug', $this->option('organization'))->firstOrFail();
        $actor = User::where('is_super_admin', true)->firstOrFail();
        foreach ($this->option('rgb-controls') ? ['rgb-light-v2'] : ['three-phase-energy-meter', 'rgb-light'] as $fixture) {
            if (DeviceProfile::where('organization_id', $organization->id)->where('code', 'simulator-'.$fixture)->exists()) {
                continue;
            }
            DB::transaction(function () use ($fixture, $organization, $actor): void {
                $definition = json_decode(file_get_contents(base_path('../../contracts/definitions/device-profiles/'.($fixture === 'rgb-light-v2' ? 'rgb-light.v2' : $fixture.'.v1').'.json')), true, 512, JSON_THROW_ON_ERROR);
                $profile = DeviceProfile::create(['organization_id' => $organization->id, 'code' => 'simulator-'.$fixture, 'name' => $definition['profile']['name'].' (simulator)', 'category' => $definition['profile']['category'], 'created_by' => $actor->id, 'updated_by' => $actor->id]);
                $parameters = [];
                foreach ($definition['parameters'] as $index => $parameter) {
                    $parameters[$parameter['uuid']] = $profile->parameters()->create([
                        'key' => $parameter['key'], 'label' => $parameter['label'], 'kind' => $parameter['kind'], 'data_type' => $parameter['data_type'],
                        'format' => $parameter['format'], 'unit' => $parameter['unit'], 'reports_state' => $parameter['reports_state'], 'accepts_command' => $parameter['accepts_command'],
                        'validation_logic' => $parameter['validation'], 'display_config' => $parameter['display'], 'reporting_config' => $parameter['reporting'], 'counter_config' => $parameter['counter'], 'sort_order' => $index,
                    ]);
                }
                foreach ($definition['calculations'] as $calculation) {
                    $model = $profile->calculations()->create(['target_profile_parameter_id' => $parameters[$calculation['target_parameter_uuid']]->id,
                        'engine' => $calculation['engine'], 'expression' => $calculation['expression'], 'trigger' => $calculation['trigger'], 'failure_policy' => $calculation['failure_policy']]);
                    foreach ($calculation['inputs'] as $input) {
                        $model->inputs()->create(['alias' => $input['alias'], 'profile_parameter_id' => $parameters[$input['parameter_uuid']]->id]);
                    }
                }
                app(PublishDeviceProfile::class)->handle($profile->fresh(), $actor, 1);
            });
        }
        $group = 'simulator-'.$organization->uuid;
        $connection = SparkplugConnection::firstOrCreate(['group_id' => $group], ['organization_id' => $organization->id, 'name' => 'Local simulator', 'host_id' => 'iot-host-'.$organization->uuid, 'username' => 'sim-host-'.$organization->uuid, 'password' => Str::random(48)]);
        app(BrokerProvisioner::class)->connection($connection);
        $gateway = SparkplugGateway::firstOrCreate(['sparkplug_connection_id' => $connection->id, 'edge_node_id' => $this->option('rgb-controls') ? 'simulator-rgb-edge' : 'simulator-edge'],
            ['organization_id' => $organization->id, 'name' => $this->option('rgb-controls') ? 'RGB simulator gateway' : 'Simulator gateway', 'username' => ($this->option('rgb-controls') ? 'sim-rgb-edge-' : 'sim-edge-').$organization->uuid, 'password' => Str::random(48)]);
        app(BrokerProvisioner::class)->gateway($gateway);
        $path = $this->option('output');
        if (! str_starts_with($path, '/') || ! str_starts_with($this->option('ca'), '/')) {
            $this->error('Use absolute output and CA paths.');

            return self::FAILURE;
        }
        if (! is_dir(dirname($path))) {
            mkdir(dirname($path), 0700, true);
        }
        $previous = umask(0077);
        try {
            file_put_contents($path, json_encode(['broker_url' => $this->option('broker'), 'group_id' => $connection->group_id, 'host_id' => $connection->host_id,
                'edge_node_id' => $gateway->edge_node_id, 'username' => $gateway->username, 'password' => $gateway->password, 'ca_file' => $this->option('ca')], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
            chmod($path, 0600);
        } finally {
            umask($previous);
        }
        $this->info('Simulator profiles are ready. Private configuration written to '.$path);

        return self::SUCCESS;
    }
}
