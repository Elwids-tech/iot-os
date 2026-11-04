<?php

declare(strict_types=1);

namespace App\Domain\Firmware\Console;

use App\Domain\Firmware\Services\FixtureStarters;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\File;

/** Builds starters from the contract fixtures, with no database, for CI and the golden outputs (spec 027 R16, R19). */
final class StarterFixtures extends Command
{
    protected $signature = 'firmware:starter-fixtures
        {--output= : Write every starter to <output>/<target>/<starter>/}
        {--revision= : Use profile revisions up to this one}
        {--golden : Rewrite contracts/firmware/fixtures/expected/}';

    protected $description = 'Build firmware starters from the contract fixtures, for CI and the golden outputs.';

    public function handle(FixtureStarters $fixtures): int
    {
        $output = $this->option('output');
        $revision = $this->option('revision') === null ? null : (int) $this->option('revision');
        if (! $output && ! $this->option('golden')) {
            $this->error('Pass --output=<directory>, --golden or both.');

            return self::FAILURE;
        }
        if ($output) {
            foreach ($fixtures->starters($revision) as $item) {
                $directory = rtrim($output, '/').'/'.$item['target'].'/'.$item['name'];
                $this->write($directory, $item['starter']['files']);
                $this->line($directory);
            }
        }
        if ($this->option('golden')) {
            $expected = $fixtures->expectedPath();
            $cases = [];
            foreach ($fixtures->golden() as $case => $files) {
                $this->write($expected.'/'.$case, $files);
                $cases[] = ['name' => $case, 'files' => array_keys($files)];
            }
            File::put($expected.'/cases.json', json_encode(['format' => 1, 'cases' => $cases], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)."\n");
            $this->line($expected);
        }

        return self::SUCCESS;
    }

    /** @param  array<string, string>  $files */
    private function write(string $directory, array $files): void
    {
        File::deleteDirectory($directory);
        foreach ($files as $path => $contents) {
            File::ensureDirectoryExists(dirname($directory.'/'.$path));
            File::put($directory.'/'.$path, $contents);
        }
    }
}
