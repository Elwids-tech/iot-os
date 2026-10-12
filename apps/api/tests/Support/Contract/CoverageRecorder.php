<?php

declare(strict_types=1);

namespace Tests\Support\Contract;

use PHPUnit\Event\TestRunner\ExecutionFinished;
use PHPUnit\Event\TestRunner\ExecutionFinishedSubscriber;
use PHPUnit\Event\TestRunner\ExecutionStarted;
use PHPUnit\Event\TestRunner\ExecutionStartedSubscriber;
use PHPUnit\Runner\Extension\Extension;
use PHPUnit\Runner\Extension\Facade;
use PHPUnit\Runner\Extension\ParameterCollection;
use PHPUnit\TextUI\Configuration\Configuration;

/**
 * Records which (operation, status) pairs the suite checked, and which tests opted out,
 * in storage/framework/testing/contract-coverage.json (git-ignored) for
 * `php artisan contract:coverage` (gate G4).
 *
 * A PHPUnit extension (phpunit.xml): the record is emptied when a run starts and written
 * when it finishes, so it always describes the last run. Tests add to it through
 * Tests\TestCase.
 */
final class CoverageRecorder implements Extension
{
    /** Relative to apps/api; App\Support\Contract\Console\ContractCoverage reads the same file. */
    public const PATH = 'storage/framework/testing/contract-coverage.json';

    /** @var array<string, array{operation: string, status: int, test: string}> */
    private static array $checked = [];

    /** @var array<string, array{test: string, reason: string}> */
    private static array $skipped = [];

    private static ?string $contractSha256 = null;

    public function bootstrap(Configuration $configuration, Facade $facade, ParameterCollection $parameters): void
    {
        $facade->registerSubscribers(
            new class implements ExecutionStartedSubscriber
            {
                public function notify(ExecutionStarted $event): void
                {
                    CoverageRecorder::reset();
                }
            },
            new class implements ExecutionFinishedSubscriber
            {
                public function notify(ExecutionFinished $event): void
                {
                    CoverageRecorder::write();
                }
            },
        );
    }

    public static function record(string $operation, int $status, string $test, string $contractSha256): void
    {
        self::$contractSha256 = $contractSha256;
        self::$checked["{$operation} {$status} {$test}"] = ['operation' => $operation, 'status' => $status, 'test' => $test];
    }

    public static function skip(string $test, string $reason): void
    {
        self::$skipped[$test] = ['test' => $test, 'reason' => $reason];
    }

    public static function reset(): void
    {
        self::$checked = [];
        self::$skipped = [];
        self::$contractSha256 = null;
        self::write();
    }

    public static function write(): void
    {
        $checked = self::$checked;
        ksort($checked, SORT_STRING);
        $skipped = self::$skipped;
        ksort($skipped, SORT_STRING);

        $path = self::path();
        if (! is_dir(dirname($path))) {
            mkdir(dirname($path), 0755, true);
        }
        file_put_contents($path, json_encode([
            'contract_sha256' => self::$contractSha256,
            'checked' => array_values($checked),
            'skipped' => array_values($skipped),
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)."\n", LOCK_EX);
    }

    public static function path(): string
    {
        return dirname(__DIR__, 3).'/'.self::PATH;
    }
}
