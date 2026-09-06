<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use App\Domain\Devices\Models\SparkplugConnection;
use App\Domain\Devices\Models\SparkplugGateway;
use Illuminate\Support\Facades\Http;

final class BrokerProvisioner
{
    private function provision(string $username, #[\SensitiveParameter] string $password, array $rules): void
    {
        abort_unless(config('devices.emqx_key') && config('devices.emqx_secret'), 503, 'Broker provisioning is not configured.');
        $client = Http::baseUrl(config('devices.emqx_url'))->withBasicAuth(config('devices.emqx_key'), config('devices.emqx_secret'))->acceptJson()->timeout(10);
        $auth = '/authentication/password_based:built_in_database/users';
        $response = $client->post($auth, ['user_id' => $username, 'password' => $password, 'is_superuser' => false]);
        if ($response->status() === 409) {
            $response = $client->put($auth.'/'.rawurlencode($username), ['password' => $password, 'is_superuser' => false]);
        }
        abort_unless($response->successful(), 503, 'Broker credential provisioning failed. Check the broker authentication configuration.');
        $response = $client->post('/authorization/sources/built_in_database/rules/users', [['username' => $username, 'rules' => [...$rules, ['permission' => 'deny', 'action' => 'all', 'topic' => '#']]]]);
        abort_unless($response->successful(), 503, 'Broker namespace authorization could not be applied.');
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
