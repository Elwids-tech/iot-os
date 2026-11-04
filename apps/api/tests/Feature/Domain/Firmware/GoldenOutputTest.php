<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Firmware;

use App\Domain\Firmware\Services\FixtureStarters;
use Tests\TestCase;

/**
 * The generator's output, byte for byte, against the golden copies in
 * contracts/firmware/fixtures/expected (spec 027 R19). After an intended change, rewrite them
 * with `php artisan firmware:starter-fixtures --golden` and review the diff.
 */
final class GoldenOutputTest extends TestCase
{
    public function test_generated_files_match_the_golden_copies(): void
    {
        $fixtures = app(FixtureStarters::class);
        $expected = $fixtures->expectedPath();
        $golden = $fixtures->golden();
        $cases = json_decode((string) file_get_contents($expected.'/cases.json'), true);

        $this->assertSame(array_keys($golden), array_column($cases['cases'], 'name'));
        foreach ($cases['cases'] as $case) {
            $this->assertSame(array_keys($golden[$case['name']]), $case['files'], $case['name']);
            foreach ($golden[$case['name']] as $path => $contents) {
                $this->assertSame((string) @file_get_contents($expected.'/'.$case['name'].'/'.$path), $contents, $case['name'].'/'.$path.' differs: rerun firmware:starter-fixtures --golden and review');
            }
        }
    }
}
