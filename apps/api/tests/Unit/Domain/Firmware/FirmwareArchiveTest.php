<?php

declare(strict_types=1);

namespace Tests\Unit\Domain\Firmware;

use App\Domain\Firmware\Services\FirmwareArchive;
use Illuminate\Support\Carbon;
use Phar;
use PharData;
use RecursiveIteratorIterator;
use Tests\TestCase;

final class FirmwareArchiveTest extends TestCase
{
    public function test_entries_are_dated_a_day_back_so_no_time_zone_unpacks_them_in_the_future(): void
    {
        $this->travelTo(Carbon::parse('2026-11-04T16:49:36Z'));
        $files = ['starter/README.md' => "Read me\n", 'starter/sdk/VERSION' => "0.1.0\n", 'starter/main/main.c' => ''];

        $zip = base64_decode(app(FirmwareArchive::class)->zip($files));

        // 2026-11-03 16:49:36 as a ZIP time and date, in every central directory entry and local header.
        $expected = [(16 << 11) | (49 << 5) | intdiv(36, 2), ((2026 - 1980) << 9) | (11 << 5) | 3];
        $this->assertSame(array_fill(0, 6, $expected), $this->stamps($zip));
        ksort($files);
        $this->assertSame($files, $this->contents($zip));
    }

    /** @return list<array{int, int}> the time and date of each central directory entry, then of each local header */
    private function stamps(string $zip): array
    {
        $stamps = [];
        foreach (["PK\x01\x02" => 12, "PK\x03\x04" => 10] as $signature => $offset) {
            preg_match_all('/'.preg_quote($signature, '/').'/', $zip, $matches, PREG_OFFSET_CAPTURE);
            foreach ($matches[0] as [, $at]) {
                $stamps[] = array_values(unpack('vtime/vdate', $zip, $at + $offset));
            }
        }

        return $stamps;
    }

    /** @return array<string, string> */
    private function contents(string $zip): array
    {
        $path = sys_get_temp_dir().'/firmware-archive-'.bin2hex(random_bytes(6)).'.zip';
        file_put_contents($path, $zip);
        try {
            $files = [];
            foreach (new RecursiveIteratorIterator(new PharData($path, 0, null, Phar::ZIP)) as $file) {
                $files[substr($file->getPathname(), strpos($file->getPathname(), '.zip/') + 5)] = $file->getContent();
            }
            ksort($files);

            return $files;
        } finally {
            unlink($path);
        }
    }
}
