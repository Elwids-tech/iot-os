<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use App\Domain\Devices\Models\DeviceOnboarding;
use Phar;
use PharData;

final class DeviceConnectionKit
{
    public function make(DeviceOnboarding $setup): array
    {
        abort_unless($setup->mode === 'direct' && $setup->provisioned_at, 422, 'Provision this direct connection before downloading its kit.');
        abort_if($setup->device->lifecycle === 'archived', 422, 'Archived devices cannot download connection kits.');
        $gateway = $setup->gateway;
        $url = config('devices.broker_public_url');
        $host = parse_url($url, PHP_URL_HOST);
        abort_unless(parse_url($url, PHP_URL_SCHEME) === 'ssl' && $host, 503, 'Configure the public MQTT TLS endpoint first.');
        $path = config('devices.ca_file');
        abort_unless(is_string($path) && is_readable($path), 503, 'The MQTT CA certificate is not available. Ask an administrator to configure it.');
        $ca = file_get_contents($path);
        abort_unless(openssl_x509_read($ca) !== false && ! str_contains($ca, 'PRIVATE KEY'), 503, 'The configured MQTT CA certificate is invalid.');
        $parameters = array_values(array_filter($setup->artifact->definition['parameters'], fn ($p) => $p['reports_state'] && $p['kind'] !== 'derived'));
        $config = [
            'broker_url' => $url, 'client_id' => $gateway->username, 'username' => $gateway->username, 'password' => $gateway->password,
            'ca_file' => 'ca.crt', 'group_id' => $gateway->connection->group_id, 'host_id' => $gateway->connection->host_id,
            'edge_node_id' => $gateway->edge_node_id, 'device_id' => '',
            'metrics' => array_map(fn ($p) => ['name' => $p['key'], 'label' => $p['label'], 'data_type' => $p['data_type'], 'unit' => $p['unit'] ?? null], $parameters),
        ];
        $rows = implode("\n", array_map(fn ($p) => '- '.$p['key'].' ('.$p['data_type'].', '.($p['unit'] ?? 'no unit').')', $parameters));
        $readme = '# Connect '.$setup->device->name."\n\n1. Install device-config.json and ca.crt on your device. Resolve ca_file relative to the configuration file.\n2. Use an MQTT 3.1.1 Sparkplug B publisher with TLS hostname and CA verification enabled.\n3. Apply the username, password and unique client_id in the configuration.\n4. Publish NBIRTH (including bdSeq and typed metrics) at spBv1.0/{$config['group_id']}/NBIRTH/{$config['edge_node_id']}. This device is its own Edge Node.\n5. Publish NDATA for changing measurements; configure NDEATH as the MQTT last will, maintain sequence numbers, and handle Node Control/Rebirth on NCMD. Use a Sparkplug B library; publishing plain JSON is not compatible.\n6. Return to onboarding to match measurements, review, and activate.\n\nExpected metrics from the selected published profile:\n{$rows}\n\nKeep this bundle private. It authenticates only this Edge Node namespace; do not share it across devices. The CA certificate verifies the broker; it is not a client certificate.\n\nBroker: {$url}\nUse a hostname reachable from the hardware and present in the broker certificate. localhost works only on the machine hosting the broker. Ask the administrator to configure the public endpoint for other hardware.\n";
        // Phar's ZIP writer needs no optional ext-zip. Keep the temporary bundle private and remove it even on errors.
        $directory = sys_get_temp_dir().'/iot-kit-'.bin2hex(random_bytes(12));
        mkdir($directory, 0700);
        $zipPath = $directory.'/connection-kit.zip';
        try {
            $zip = new PharData($zipPath, 0, null, Phar::ZIP);
            $zip->addFromString('device-config.json', json_encode($config, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
            $zip->addFromString('ca.crt', $ca);
            $zip->addFromString('quickstart.md', $readme);
            unset($zip);
            $archive = base64_encode(file_get_contents($zipPath));
        } finally {
            if (is_file($zipPath)) {
                unlink($zipPath);
            }
            rmdir($directory);
        }

        return ['filename' => $setup->device->code.'-connection-kit.zip', 'archive_base64' => $archive, 'config' => $config, 'ca_certificate' => $ca];
    }
}
