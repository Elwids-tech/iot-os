<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use App\Domain\Devices\Models\SparkplugConnection;
use App\Domain\Devices\Models\SparkplugGateway;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

final class BrokerProvisioner
{
    /**
     * Mosquitto's Dynamic Security is changed only through broker-admin (ADR-019),
     * which replaces the client's password and rules and denies everything else.
     */
    private function provision(string $username, #[\SensitiveParameter] string $password, array $rules): void
    {
        abort_unless(config('devices.broker_admin_token'), 503, 'Broker provisioning is not configured.');
        $response = Http::baseUrl(config('devices.broker_admin_url'))
            ->withToken(config('devices.broker_admin_token'))->acceptJson()->timeout(30)
            ->put('/clients', compact('username', 'password', 'rules'));
        abort_unless($response->successful(), 503, 'Broker credential or namespace provisioning failed.');
    }

    private function rule(string $action, string $topic): array
    {
        return ['permission' => 'allow', 'action' => $action, 'topic' => $topic];
    }

    public function connection(SparkplugConnection $connection): void
    {
        $root = 'spBv1.0/'.$connection->group_id.'/';
        $rules = [];
        foreach (['NBIRTH', 'NDATA', 'NDEATH'] as $type) {
            $rules[] = $this->rule('subscribe', $root.$type.'/+');
        }
        foreach (['DBIRTH', 'DDATA', 'DDEATH'] as $type) {
            $rules[] = $this->rule('subscribe', $root.$type.'/+/+');
        }
        $rules[] = $this->rule('publish', $root.'NCMD/+');
        $rules[] = $this->rule('publish', $root.'DCMD/+/+');
        $rules[] = $this->rule('all', 'spBv1.0/STATE/'.$connection->host_id);
        $this->provision($connection->username, $connection->password, $rules);
        $connection->update(['status' => 'ready', 'diagnostic' => null]);
        DeviceAudit::enqueue('connection.changed.v1', ['connection_uuid' => $connection->uuid]);
    }

    /**
     * Retires a gateway's identity: a random password nobody keeps, and only the STATE
     * subscription left because broker-admin needs at least one rule.
     */
    public function revoke(SparkplugGateway $gateway): void
    {
        $this->provision($gateway->username, Str::random(48), [$this->rule('subscribe', 'spBv1.0/STATE/'.$gateway->connection->host_id)]);
    }

    public function gateway(SparkplugGateway $gateway): void
    {
        $connection = $gateway->connection;
        $root = 'spBv1.0/'.$connection->group_id.'/';
        $rules = [];
        foreach (['NBIRTH', 'NDATA', 'NDEATH'] as $type) {
            $rules[] = $this->rule('publish', $root.$type.'/'.$gateway->edge_node_id);
        }
        foreach (['DBIRTH', 'DDATA', 'DDEATH'] as $type) {
            $rules[] = $this->rule('publish', $root.$type.'/'.$gateway->edge_node_id.'/+');
        }
        $rules[] = $this->rule('subscribe', $root.'NCMD/'.$gateway->edge_node_id);
        $rules[] = $this->rule('subscribe', $root.'DCMD/'.$gateway->edge_node_id.'/+');
        $rules[] = $this->rule('subscribe', 'spBv1.0/STATE/'.$connection->host_id);
        $this->provision($gateway->username, $gateway->password, $rules);
    }
}
