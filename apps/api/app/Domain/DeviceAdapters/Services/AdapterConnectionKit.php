<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Services;

use Phar;
use PharData;

final class AdapterConnectionKit
{
    public function make(array $configuration): array
    {
        $directory = sys_get_temp_dir().'/iot-adapter-kit-'.bin2hex(random_bytes(12));
        mkdir($directory, 0700);
        $file = $directory.'/connection-kit.zip';
        try {
            $zip = new PharData($file, 0, null, Phar::ZIP);
            $zip->addFromString('device-config.json', json_encode($configuration, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
            $zip->addFromString('ca.crt', $configuration['ca_certificate']);
            $zip->addFromString('quickstart.md', "# Connect your manufacturer MQTT device\n\n1. Configure the hardware with the broker URL, username and password in device-config.json.\n2. Install ca.crt as the trusted broker CA; keep TLS hostname verification enabled. This is a server CA, not a client certificate.\n3. Keep the manufacturer's payload unchanged. Publish on an allowed topic listed in publish_topics, replacing wildcard levels with the device's real topic.\n4. Deploy the tested adapter and review your serial in its Devices step. Activate it to start storing readings under a virtual device ID.\n5. Verify both broker and publisher connectivity, then verify stored readings on the platform device.\n\nKeep this bundle private. Rotate or revoke this credential in the adapter's Connection step. A localhost endpoint works only on the machine hosting the broker; separate hardware needs a reachable administrator-configured hostname covered by its certificate.\n");
            unset($zip);

            return [...$configuration, 'filename' => 'device-connection-'.$configuration['credential_uuid'].'.zip', 'archive_base64' => base64_encode(file_get_contents($file))];
        } finally {
            @unlink($file);
            @rmdir($directory);
        }
    }
}
