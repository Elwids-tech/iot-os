<?php

declare(strict_types=1);

namespace App\Domain\Firmware\Services;

use Phar;
use PharData;

/** ZIP archives for kits and starters, built in a private temporary directory that is always removed. */
final class FirmwareArchive
{
    /**
     * @param  array<string, string>  $files  archive path => contents, in archive order
     * @return string the ZIP, base64-encoded
     */
    public function zip(array $files): string
    {
        // Phar's ZIP writer needs no optional ext-zip. Keep the temporary archive private and remove it even on errors.
        $directory = sys_get_temp_dir().'/iot-kit-'.bin2hex(random_bytes(12));
        mkdir($directory, 0700);
        $zipPath = $directory.'/archive.zip';
        try {
            $zip = new PharData($zipPath, 0, null, Phar::ZIP);
            foreach ($files as $path => $contents) {
                $zip->addFromString($path, $contents);
            }
            unset($zip);

            return base64_encode(file_get_contents($zipPath));
        } finally {
            if (is_file($zipPath)) {
                unlink($zipPath);
            }
            rmdir($directory);
        }
    }
}
