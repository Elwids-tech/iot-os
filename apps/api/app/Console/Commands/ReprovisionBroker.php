<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Domain\Devices\Models\SparkplugConnection;
use App\Domain\Devices\Services\BrokerProvisioner;
use Illuminate\Console\Command;

final class ReprovisionBroker extends Command
{
    protected $signature = 'devices:reprovision-broker';

    protected $description = 'Reapply existing managed credentials and tenant ACLs without rotating device passwords';

    public function handle(BrokerProvisioner $provisioner): int
    {
        $connections = 0;
        $gateways = 0;
        foreach (SparkplugConnection::with('gateways')->cursor() as $connection) {
            $provisioner->connection($connection);
            $connections++;
            foreach ($connection->gateways as $gateway) {
                // Auto-discovered sources can have no managed credentials.
                if ($gateway->username && $gateway->password) {
                    $provisioner->gateway($gateway);
                    $gateways++;
                }
            }
        }
        $this->info("Reprovisioned {$connections} connections and {$gateways} managed gateways.");

        return self::SUCCESS;
    }
}
