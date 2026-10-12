<?php

declare(strict_types=1);

namespace App\Support\Contract\Console;

use App\Support\Contract\ContractFiles;
use App\Support\Contract\ContractJson;
use App\Support\Contract\ContractRoutes;
use App\Support\Contract\OpenSchema;
use Illuminate\Console\Command;
use JsonException;

/**
 * Gate G4 coverage (specs/001-openapi-contract research R8): after the suite, every
 * required (operation, status) pair must have been checked at least once.
 *
 * - every fully described `api/v1` operation: a 2xx;
 * - every integration operation: a 2xx, 401, 403 and 404, plus 422 when it takes a
 *   request body or a required query parameter (`scramble.contract.require_integration_coverage`
 *   turns this off; it is on).
 *
 * It reads the record Tests\Support\Contract\CoverageRecorder writes during
 * `php artisan test`, and lists the tests that opted out with #[WithoutContractCheck].
 */
final class ContractCoverage extends Command
{
    use ReportsGateFailures;

    public const RECORD = 'framework/testing/contract-coverage.json';

    protected $signature = 'contract:coverage
        {--file= : The coverage record (default: storage/framework/testing/contract-coverage.json, written by php artisan test)}';

    protected $description = 'Check that the test suite exercised every required operation and status (gate G4)';

    private int $failures = 0;

    public function handle(): int
    {
        $file = is_string($this->option('file')) && $this->option('file') !== '' ? $this->option('file') : storage_path(self::RECORD);
        $contract = ContractFiles::document();
        if (! is_file($contract)) {
            $this->recordFailure('openapi.json', "{$contract} is missing", 'run php artisan contract:export');

            return self::FAILURE;
        }
        if (! is_file($file)) {
            $this->recordFailure('coverage', "no coverage record at {$file}", 'run php artisan test first; it writes the record');

            return self::FAILURE;
        }

        try {
            $json = (string) file_get_contents($contract);
            $document = ContractJson::decode($json);
            $record = json_decode((string) file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException $exception) {
            $this->recordFailure('coverage', "unreadable contract or coverage record: {$exception->getMessage()}", 'run php artisan contract:export, then php artisan test');

            return self::FAILURE;
        }

        $checked = is_array($record['checked'] ?? null) ? $record['checked'] : [];
        if ($checked !== [] && ($record['contract_sha256'] ?? null) !== hash('sha256', $json)) {
            $this->recordFailure('coverage', 'the record was written against a different openapi.json', 'run php artisan test again after php artisan contract:export');

            return self::FAILURE;
        }

        $seen = [];
        foreach ($checked as $entry) {
            $seen[(string) ($entry['operation'] ?? '')][(int) ($entry['status'] ?? 0)] = true;
        }

        $operations = $this->operations($document);
        $requireIntegration = (bool) config('scramble.contract.require_integration_coverage');
        $required = 0;
        foreach ($operations as $key => $operation) {
            $statuses = $seen[$key] ?? [];
            $isIntegration = ($operation['x-audience'] ?? null) === 'integration';
            if ($isIntegration && ! $requireIntegration) {
                continue;
            }
            if (! $isIntegration && ($operation['x-schema-status'] ?? null) === 'pending') {
                continue;
            }

            $required++;
            if (array_filter(array_keys($statuses), static fn (int $status): bool => $status >= 200 && $status < 300) === []) {
                $this->recordFailure("{$key} 2xx", 'no success response was checked', $isIntegration
                    ? 'add a test that calls it successfully (tests/Feature/Domain/Integrations or Geospatial)'
                    : 'add a feature test that calls it successfully');
            }
            if (! $isIntegration) {
                continue;
            }
            $errors = [401, 403, 404];
            if ($this->takesInput($operation, $document)) {
                $errors[] = 422;
            }
            foreach ($errors as $status) {
                $required++;
                if (! isset($statuses[$status])) {
                    $this->recordFailure("{$key} {$status}", 'never checked by the suite', 'add the operation to the data providers in tests/Feature/Contract/IntegrationContractTest.php');
                }
            }
        }

        $skipped = is_array($record['skipped'] ?? null) ? $record['skipped'] : [];
        $this->reportSummary($checked, $seen, count($operations), $required, $requireIntegration);
        if ($skipped !== []) {
            $this->line(count($skipped).' test(s) opted out with #[WithoutContractCheck]:');
            foreach ($skipped as $entry) {
                $this->line('  '.($entry['test'] ?? '?').': '.($entry['reason'] ?? ''));
            }
        }

        return $this->failures > 0 ? self::FAILURE : self::SUCCESS;
    }

    /**
     * @param  list<array<string, mixed>>  $checked
     * @param  array<string, array<int, true>>  $seen
     */
    private function reportSummary(array $checked, array $seen, int $operations, int $required, bool $requireIntegration): void
    {
        $pairs = array_sum(array_map('count', $seen));
        $this->line(count($checked).' checked responses (test, operation and status): '.$pairs.' operation and status pairs across '.count($seen)." of {$operations} operations.");
        $this->line($this->failures === 0
            ? "{$required} required pairs, all checked."
            : "{$required} required pairs, {$this->failures} never checked.");
        if (! $requireIntegration) {
            $this->line('Integration pairs are not required (scramble.contract.require_integration_coverage is off).');
        }
    }

    /**
     * @param  array<string, mixed>  $operation
     * @param  array<string, mixed>  $document
     */
    private function takesInput(array $operation, array $document): bool
    {
        if (isset($operation['requestBody'])) {
            return true;
        }
        foreach ($operation['parameters'] ?? [] as $parameter) {
            if (is_array($parameter) && isset($parameter['$ref']) && is_string($parameter['$ref'])) {
                $parameter = OpenSchema::resolve($parameter['$ref'], $document);
            }
            if (is_array($parameter) && ($parameter['in'] ?? null) === 'query' && ($parameter['required'] ?? false) === true) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  array<string, mixed>  $document
     * @return array<string, array<string, mixed>>
     */
    private function operations(array $document): array
    {
        $operations = [];
        foreach ($document['paths'] ?? [] as $path => $item) {
            foreach ((array) $item as $method => $operation) {
                if (in_array($method, ContractRoutes::METHODS, true) && is_array($operation)) {
                    $operations[strtoupper($method).' '.$path] = $operation;
                }
            }
        }
        ksort($operations, SORT_STRING);

        return $operations;
    }

    private function recordFailure(string $subject, string $difference, string $fix): void
    {
        $this->failures++;
        $this->gateFailure('G4', $subject, $difference, $fix);
    }
}
