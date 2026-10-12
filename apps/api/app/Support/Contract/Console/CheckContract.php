<?php

declare(strict_types=1);

namespace App\Support\Contract\Console;

use App\Support\Contract\ContractException;
use App\Support\Contract\ContractFiles;
use App\Support\Contract\ContractJson;
use App\Support\Contract\ContractRoutes;
use App\Support\Contract\OpenSchema;
use App\Support\Contract\PendingSchemas;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Process;
use JsonException;

/**
 * Gate G3: every operation is fully described unless it is on the pending-schema list,
 * and that list only shrinks.
 */
final class CheckContract extends Command
{
    use ReportsGateFailures;

    protected $signature = 'contract:check
        {--base= : Git revision whose pending-schemas.json the list may not outgrow, for example origin/main}';

    protected $description = 'Check the contract against the pending-schema list (gate G3)';

    private int $failures = 0;

    public function handle(): int
    {
        try {
            if (! is_file(ContractFiles::document())) {
                throw new ContractException(ContractFiles::document().' is missing.');
            }
            $document = ContractJson::decode((string) file_get_contents(ContractFiles::document()));
            $pending = PendingSchemas::load();
        } catch (ContractException|JsonException $exception) {
            $this->recordFailure('contracts/openapi', $exception->getMessage(), 'run php artisan contract:export, or correct pending-schemas.json');

            return self::FAILURE;
        }

        foreach ($pending->orderProblems() as $problem) {
            $this->recordFailure('pending-schemas.json', $problem, 'sort contracts/openapi/pending-schemas.json by operation and remove repeated entries');
        }

        $operations = $this->operations($document);
        $forbidIntegration = (bool) config('scramble.contract.forbid_pending_integration');
        foreach ($pending->operations() as $key) {
            $operation = $operations[$key] ?? null;
            if ($operation === null) {
                $this->recordFailure($key, 'listed in pending-schemas.json but there is no such operation', 'remove it from contracts/openapi/pending-schemas.json');

                continue;
            }
            if (($operation['x-schema-status'] ?? null) !== 'pending' || $this->closedBodies($operation, $document) !== []) {
                $this->recordFailure($key, 'listed in pending-schemas.json but its success body is described', 'remove it from contracts/openapi/pending-schemas.json, then run php artisan contract:export');
            }
            if ($forbidIntegration && ($operation['x-audience'] ?? null) === 'integration') {
                $this->recordFailure($key, 'integration operations must be fully described, never pending', 'describe it in contracts/openapi/supplements/ and remove it from pending-schemas.json');
            }
        }

        foreach ($operations as $key => $operation) {
            if ($pending->has($key)) {
                continue;
            }
            if (isset($operation['x-schema-status'])) {
                $this->recordFailure($key, 'marked x-schema-status but not on the pending-schema list', 'run php artisan contract:export');
            }
            foreach ($this->openBodies($operation, $document) as $where) {
                $this->recordFailure($key, "open response schema at {$where}", 'describe the response in contracts/openapi/supplements/<domain>.yaml (or with a @response annotation), then run php artisan contract:export; new operations cannot be added to pending-schemas.json');
            }
        }

        if (is_string($base = $this->option('base')) && $base !== '') {
            $this->checkAgainstBase($base, $pending);
        }

        if ($this->failures > 0) {
            return self::FAILURE;
        }
        $this->info(count($operations).' operations checked; '.$pending->count().' have pending response schemas.');

        return self::SUCCESS;
    }

    private function checkAgainstBase(string $base, PendingSchemas $pending): void
    {
        $directory = ContractFiles::directory();
        if (! Process::path($directory)->run(['git', 'rev-parse', '--verify', '--quiet', $base.'^{commit}'])->successful()) {
            $this->recordFailure('pending-schemas.json', "the base revision {$base} is not available", 'fetch it first, for example git fetch --depth=1 origin main');

            return;
        }
        $show = Process::path($directory)->run(['git', 'show', $base.':./pending-schemas.json']);
        if (! $show->successful()) {
            $this->line("{$base} has no pending-schemas.json; the size comparison starts with the next pull request.");

            return;
        }
        try {
            $baseCount = PendingSchemas::fromJson($show->output(), "{$base}:pending-schemas.json")->count();
        } catch (ContractException $exception) {
            $this->line("Skipping the size comparison: {$exception->getMessage()}");

            return;
        }
        if ($pending->count() > $baseCount) {
            $this->recordFailure('pending-schemas.json', "{$pending->count()} entries, more than the {$baseCount} on {$base}", 'the list only shrinks: describe the operation in a supplement instead of listing it');
        }
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

        return $operations;
    }

    /**
     * Open parts of the JSON success bodies, as `<status> <media type><pointer>`.
     *
     * @param  array<string, mixed>  $operation
     * @param  array<string, mixed>  $document
     * @return list<string>
     */
    private function openBodies(array $operation, array $document): array
    {
        $open = [];
        foreach ($this->successSchemas($operation, $document) as $where => $schema) {
            foreach (OpenSchema::openParts($schema, $document) as $pointer) {
                $open[] = $where.($pointer === '/' ? '' : $pointer);
            }
        }

        return $open;
    }

    /**
     * JSON success bodies that are fully closed.
     *
     * @param  array<string, mixed>  $operation
     * @param  array<string, mixed>  $document
     * @return list<string>
     */
    private function closedBodies(array $operation, array $document): array
    {
        $closed = [];
        foreach ($this->successSchemas($operation, $document) as $where => $schema) {
            if (OpenSchema::openParts($schema, $document) === []) {
                $closed[] = $where;
            }
        }

        return $closed;
    }

    /**
     * @param  array<string, mixed>  $operation
     * @param  array<string, mixed>  $document
     * @return array<string, mixed> schemas keyed `<status> <media type>`
     */
    private function successSchemas(array $operation, array $document): array
    {
        $schemas = [];
        foreach ($operation['responses'] ?? [] as $status => $response) {
            if (! str_starts_with((string) $status, '2')) {
                continue;
            }
            if (is_array($response) && isset($response['$ref'])) {
                $response = OpenSchema::resolve($response['$ref'], $document);
            }
            foreach ((is_array($response) ? $response['content'] ?? [] : []) as $mediaType => $content) {
                if (str_contains((string) $mediaType, 'json')) {
                    $schemas["{$status} {$mediaType}"] = is_array($content) ? ($content['schema'] ?? new \stdClass) : new \stdClass;
                }
            }
        }

        return $schemas;
    }

    private function recordFailure(string $subject, string $difference, string $fix): void
    {
        $this->failures++;
        $this->gateFailure('G3', $subject, $difference, $fix);
    }
}
