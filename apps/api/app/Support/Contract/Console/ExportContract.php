<?php

declare(strict_types=1);

namespace App\Support\Contract\Console;

use App\Support\Contract\ContractException;
use App\Support\Contract\ContractExporter;
use App\Support\Contract\ContractFiles;
use App\Support\Contract\ContractJson;
use App\Support\Contract\ContractRoutes;
use Illuminate\Console\Command;
use JsonException;

/**
 * Gate G1: contracts/openapi/openapi.json is exactly what the application and the
 * supplements produce.
 */
final class ExportContract extends Command
{
    use ReportsGateFailures;

    protected $signature = 'contract:export
        {--check : Fail, listing the differences, when the committed openapi.json is not a fresh export}';

    protected $description = 'Write the public API contract to contracts/openapi/openapi.json';

    public function handle(ContractExporter $exporter): int
    {
        try {
            $fresh = $exporter->encode();
        } catch (ContractException $exception) {
            $this->gateFailure('G1', 'export', $exception->getMessage(), 'correct the supplement, pending list or route named above, then run php artisan contract:export');

            return self::FAILURE;
        }
        foreach ($exporter->warnings as $warning) {
            $this->warn($warning);
        }
        if ($exporter->diagnostics > 0) {
            $this->line("Scramble reported {$exporter->diagnostics} inference issues (php artisan scramble:analyze lists them on a migrated database).");
        }

        $path = ContractFiles::document();
        if (! $this->option('check')) {
            file_put_contents($path, $fresh);
            $operations = 0;
            foreach (ContractJson::decode($fresh)['paths'] ?? [] as $item) {
                $operations += count(array_intersect(array_keys((array) $item), ContractRoutes::METHODS));
            }
            $this->info("Wrote {$path} ({$operations} operations).");

            return self::SUCCESS;
        }

        $committed = is_file($path) ? (string) file_get_contents($path) : null;
        if ($committed === $fresh) {
            $this->info('contracts/openapi/openapi.json matches a fresh export.');

            return self::SUCCESS;
        }

        foreach ($this->differences($committed, $fresh) as [$subject, $difference]) {
            $this->gateFailure('G1', $subject, $difference, 'run php artisan contract:export and commit contracts/openapi/openapi.json (never edit it by hand)');
        }

        return self::FAILURE;
    }

    /**
     * @return list<array{0: string, 1: string}>
     */
    private function differences(?string $committed, string $fresh): array
    {
        if ($committed === null) {
            return [['openapi.json', 'missing']];
        }
        try {
            $before = $this->index(ContractJson::decode($committed));
        } catch (JsonException) {
            return [['openapi.json', 'not valid JSON']];
        }
        $after = $this->index(ContractJson::decode($fresh));

        $differences = [];
        foreach ($after as $subject => $encoded) {
            if (! array_key_exists($subject, $before)) {
                $differences[] = [$subject, 'added'];
            } elseif ($before[$subject] !== $encoded) {
                $differences[] = [$subject, 'changed'];
            }
        }
        foreach (array_diff_key($before, $after) as $subject => $encoded) {
            $differences[] = [$subject, 'removed'];
        }

        return $differences !== [] ? $differences : [['openapi.json', 'formatting differs from the export']];
    }

    /**
     * Operations and components by name, everything else by top-level key.
     *
     * @param  array<string, mixed>  $document
     * @return array<string, string>
     */
    private function index(array $document): array
    {
        $index = [];
        foreach ($document['paths'] ?? [] as $path => $item) {
            foreach ((array) $item as $method => $operation) {
                $subject = in_array($method, ContractRoutes::METHODS, true) ? strtoupper($method).' '.$path : "paths.{$path}.{$method}";
                $index[$subject] = ContractJson::encode($operation);
            }
        }
        foreach ($document['components'] ?? [] as $type => $components) {
            foreach ((array) $components as $name => $component) {
                $index["components.{$type}.{$name}"] = ContractJson::encode($component);
            }
        }
        foreach ($document as $key => $value) {
            if (! in_array($key, ['paths', 'components'], true)) {
                $index[(string) $key] = ContractJson::encode($value);
            }
        }

        return $index;
    }
}
