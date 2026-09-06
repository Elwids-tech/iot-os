<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Domain\Devices\Models\SparkplugGateway;
use Illuminate\Console\Command;

final class ExportGatewayConfiguration extends Command
{
    protected $signature = 'devices:export-gateway {gateway : Gateway UUID} {--output= : New absolute private file path} {--broker= : TLS broker URL reachable by the gateway} {--ca= : Absolute CA certificate path on the gateway}';

    protected $description = 'Export private credentials for an operator to install on a registered gateway.';

    public function handle(): int
    {
        $output = $this->option('output');
        $broker = $this->option('broker') ?: config('devices.broker_url');
        if (! is_string($output) || ! str_starts_with($output, '/') || file_exists($output) || ! is_dir(dirname($output)) || ! str_starts_with($broker, 'ssl://') || ! str_starts_with((string) $this->option('ca'), '/')) {
            $this->error('Provide a new absolute output path in an existing directory, an ssl:// broker URL, and an absolute CA path.');

            return self::FAILURE;
        }
        $gateway = SparkplugGateway::where('uuid', $this->argument('gateway'))->with('connection')->firstOrFail();
        if (! $gateway->username || ! $gateway->password || $gateway->connection->status !== 'ready') {
            $this->error('Register and provision this gateway before exporting its configuration.');

            return self::FAILURE;
        }
        $mask = umask(0077);
        try {
            $file = fopen($output, 'x');
            if (! $file) {
                throw new \RuntimeException('The private output file could not be created.');
            }
            try {
                fwrite($file, json_encode(['broker_url' => $broker, 'group_id' => $gateway->connection->group_id, 'host_id' => $gateway->connection->host_id, 'edge_node_id' => $gateway->edge_node_id, 'username' => $gateway->username, 'password' => $gateway->password, 'ca_file' => $this->option('ca')], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
            } finally {
                fclose($file);
            }
        } finally {
            umask($mask);
        }
        $this->info('Private gateway configuration written to '.$output.'.');

        return self::SUCCESS;
    }
}
