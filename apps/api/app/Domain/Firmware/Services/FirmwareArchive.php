<?php

declare(strict_types=1);

namespace App\Domain\Firmware\Services;

use Phar;
use PharData;
use RuntimeException;

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

            return base64_encode($this->backdate((string) file_get_contents($zipPath), now()->subDay()->getTimestamp()));
        } finally {
            if (is_file($zipPath)) {
                unlink($zipPath);
            }
            rmdir($directory);
        }
    }

    /**
     * Dates every entry at $time. A ZIP time is a wall-clock time with no zone, and Phar
     * writes the server's UTC one, so a starter unpacked west of UTC would hold files from
     * hours ahead, and CMake would regenerate its build on every run (Ninja gives up). A
     * day back is in the past in every zone.
     */
    private function backdate(string $zip, int $time): string
    {
        [$year, $month, $day, $hour, $minute, $second] = array_map('intval', explode(' ', gmdate('Y n j G i s', $time)));
        $stamp = pack('vv', ($hour << 11) | ($minute << 5) | intdiv($second, 2), (($year - 1980) << 9) | ($month << 5) | $day);
        $end = strrpos($zip, "PK\x05\x06");
        if ($end === false) {
            throw new RuntimeException('The firmware archive has no central directory.');
        }
        ['count' => $count, 'offset' => $position] = unpack('vcount/x4/Voffset', $zip, $end + 10);
        for ($entry = 0; $entry < $count; $entry++) {
            $header = unpack('a4signature/x24/vname/vextra/vcomment/x8/Vlocal', $zip, $position);
            if ($header['signature'] !== "PK\x01\x02" || substr($zip, $header['local'], 4) !== "PK\x03\x04") {
                throw new RuntimeException('The firmware archive has an unexpected layout.');
            }
            // Modification time and date: in the central directory entry, then in the local header.
            foreach ([$position + 12, $header['local'] + 10] as $at) {
                for ($byte = 0; $byte < 4; $byte++) {
                    $zip[$at + $byte] = $stamp[$byte];
                }
            }
            $position += 46 + $header['name'] + $header['extra'] + $header['comment'];
        }

        return $zip;
    }
}
