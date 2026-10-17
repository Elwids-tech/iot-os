<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Domain\Devices\Models\SparkplugConnection;
use App\Domain\Devices\Services\BrokerProvisioner;
use Closure;
use Illuminate\Console\Command;
use Symfony\Component\HttpKernel\Exception\HttpException;

final class ReprovisionBroker extends Command
{
    protected $signature = 'devices:reprovision-broker';

    protected $description = 'Reapply existing managed credentials and tenant ACLs without rotating device passwords';

    public function handle(BrokerProvisioner $provisioner): int
    {
        $connections = 0;
        $gateways = 0;
        $failed = [];
        foreach (SparkplugConnection::with('gateways')->cursor() as $connection) {
            if ($this->apply(fn () => $provisioner->connection($connection), "connection {$connection->uuid}", $failed)) {
                $connections++;
            }
            foreach ($connection->gateways as $gateway) {
                // Auto-discovered sources can have no managed credentials.
                if ($gateway->username && $gateway->password && $this->apply(fn () => $provisioner->gateway($gateway), "gateway {$gateway->uuid}", $failed)) {
                    $gateways++;
                }
            }
        }
        $this->info("Reprovisioned {$connections} connections and {$gateways} managed gateways.");
        if ($failed !== []) {
            $this->error('Not reprovisioned (broker-admin accepts host-, edge- and simulator usernames only; docs/ops/broker.md):');
            foreach ($failed as $line) {
                $this->line('  '.$line);
            }

            return self::FAILURE;
        }

        return self::SUCCESS;
    }

    /**
     * One rejected identity must not leave every identity after it without
     * credentials, as on a fresh broker.
     *
     * @param  list<string>  $failed
     */
    private function apply(Closure $provision, string $label, array &$failed): bool
    {
        try {
            $provision();

            return true;
        } catch (HttpException $exception) {
            $failed[] = "{$label}: {$exception->getMessage()}";

            return false;
        }
    }
}
