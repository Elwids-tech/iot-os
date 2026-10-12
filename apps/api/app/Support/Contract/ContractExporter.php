<?php

declare(strict_types=1);

namespace App\Support\Contract;

use Dedoc\Scramble\Generator;
use Dedoc\Scramble\Scramble;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Process;

/**
 * Produces contracts/openapi/openapi.json: Scramble's inference, then path constraints,
 * security, supplements and the pending list, in a stable form.
 *
 * Export once per process. Scramble keeps its analysis in container singletons, and a
 * second export in the same process can lose parameters inferred from method calls.
 */
final class ContractExporter
{
    /**
     * Scramble reads column types from the database. A private, freshly migrated SQLite
     * database keeps the output independent of the developer's database.
     */
    private const CONNECTION = 'contract_export';

    private const MEMORY_LIMIT_BYTES = 1024 ** 3;

    private const TOP_LEVEL_ORDER = ['openapi', 'info', 'servers', 'security', 'tags', 'paths', 'webhooks', 'components'];

    /**
     * @var list<string>
     */
    public array $warnings = [];

    public int $diagnostics = 0;

    public function __construct(
        private readonly Generator $generator,
        private readonly PathConstraintTransformer $pathConstraints,
        private readonly SecurityTransformer $security,
        private readonly SupplementTransformer $supplements,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function export(): array
    {
        $this->raiseMemoryLimit();
        $routes = ContractRoutes::index();
        $document = $this->generate();
        $document = $this->withoutCheckoutPaths($document, rtrim(base_path(), '/').'/');
        $document['servers'] = [['url' => '/api']];

        $document = $this->pathConstraints->apply($document, $routes);
        $document = $this->security->apply($document, $routes);
        $document = $this->supplements->apply($document, PendingSchemas::load());
        $this->warnings = $this->supplements->warnings;

        $this->assertComplete($document);

        return $this->sorted($document);
    }

    public function encode(): string
    {
        return ContractJson::encode($this->export());
    }

    /**
     * @return array<string, mixed>
     */
    private function generate(): array
    {
        if (app()->configurationIsCached()) {
            throw new ContractException('The configuration is cached, so the export cannot use a database of its own. Run php artisan config:clear first.');
        }

        $database = (string) tempnam(sys_get_temp_dir(), 'contract-export-');
        try {
            // A separate process, so migrations cannot touch this process's cache or database.
            $migrate = Process::path(base_path())
                ->env(['DB_CONNECTION' => 'sqlite', 'DB_DATABASE' => $database, 'DB_URL' => '', 'CACHE_STORE' => 'array'])
                ->timeout(300)
                ->run([PHP_BINARY, 'artisan', 'migrate', '--force', '--no-interaction']);
            if (! $migrate->successful()) {
                throw new ContractException("Migrating the export database failed:\n".trim($migrate->errorOutput()."\n".$migrate->output()));
            }

            $previous = config('database.default');
            config(['database.connections.'.self::CONNECTION => ['driver' => 'sqlite', 'database' => $database, 'prefix' => '', 'foreign_key_constraints' => true]]);
            DB::purge(self::CONNECTION);
            config(['database.default' => self::CONNECTION]);
            try {
                $result = $this->generator->generate(Scramble::getGeneratorConfig(Scramble::DEFAULT_API));
            } finally {
                config(['database.default' => $previous]);
                DB::purge(self::CONNECTION);
            }
        } finally {
            @unlink($database);
        }
        $this->diagnostics = $result->diagnostics()->count();

        return ContractJson::decode(json_encode($result->spec(), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
    }

    /**
     * Scramble's analysis of the whole application peaks above PHP's default 128 MB.
     */
    private function raiseMemoryLimit(): void
    {
        $limit = (string) ini_get('memory_limit');
        if ($limit !== '-1' && $this->bytes($limit) < self::MEMORY_LIMIT_BYTES) {
            ini_set('memory_limit', (string) self::MEMORY_LIMIT_BYTES);
        }
    }

    private function bytes(string $limit): int
    {
        $value = (int) $limit;

        return match (strtolower(substr(trim($limit), -1))) {
            'g' => $value * 1024 ** 3,
            'm' => $value * 1024 ** 2,
            'k' => $value * 1024,
            default => $value,
        };
    }

    /**
     * Scramble writes analysis errors, with absolute file paths, into descriptions.
     */
    private function withoutCheckoutPaths(mixed $node, string $basePath): mixed
    {
        if (is_string($node)) {
            return str_replace($basePath, '', $node);
        }
        if (! is_array($node)) {
            return $node;
        }
        foreach ($node as $key => $child) {
            $node[$key] = $this->withoutCheckoutPaths($child, $basePath);
        }

        return $node;
    }

    /**
     * @param  array<string, mixed>  $document
     */
    private function assertComplete(array $document): void
    {
        $problems = [];
        foreach (array_unique(SupplementTransformer::references($document)) as $ref) {
            if (! str_starts_with($ref, '#/')) {
                continue;
            }
            try {
                OpenSchema::resolve($ref, $document);
            } catch (ContractException) {
                $problems[] = "{$ref} is referenced but not defined (add it to a supplement).";
            }
        }
        foreach ($document['paths'] ?? [] as $path => $item) {
            foreach ($item as $method => $operation) {
                if (! in_array($method, ContractRoutes::METHODS, true)) {
                    continue;
                }
                $key = strtoupper($method).' '.$path;
                if (! isset($operation['x-audience'])) {
                    $problems[] = "{$key} has no x-audience.";
                }
                foreach ($operation['security'] ?? [] as $requirement) {
                    foreach (array_keys($requirement) as $scheme) {
                        if (! isset($document['components']['securitySchemes'][$scheme])) {
                            $problems[] = "{$key} uses the security scheme {$scheme}, which is not defined (shared.yaml).";
                        }
                    }
                }
            }
        }
        if ($problems !== []) {
            throw new ContractException("The exported contract is incomplete:\n  ".implode("\n  ", array_values(array_unique($problems))));
        }
    }

    /**
     * Paths, components and responses in a fixed order so diffs stay readable.
     *
     * @param  array<string, mixed>  $document
     * @return array<string, mixed>
     */
    private function sorted(array $document): array
    {
        ksort($document['paths'], SORT_STRING);
        foreach ($document['paths'] as $path => $item) {
            uksort($item, static fn (string $a, string $b): int => self::methodRank($a) <=> self::methodRank($b) ?: strcmp($a, $b));
            foreach ($item as $method => $operation) {
                if (is_array($operation) && isset($operation['responses']) && is_array($operation['responses'])) {
                    ksort($operation['responses'], SORT_STRING);
                    $item[$method] = $operation;
                }
            }
            $document['paths'][$path] = $item;
        }
        if (isset($document['webhooks'])) {
            ksort($document['webhooks'], SORT_STRING);
        }
        foreach ($document['components'] ?? [] as $type => $components) {
            if (is_array($components)) {
                ksort($components, SORT_STRING);
                $document['components'][$type] = $components;
            }
        }
        if (isset($document['components']) && is_array($document['components'])) {
            ksort($document['components'], SORT_STRING);
        }

        $ordered = [];
        foreach (self::TOP_LEVEL_ORDER as $key) {
            if (array_key_exists($key, $document)) {
                $ordered[$key] = $document[$key];
                unset($document[$key]);
            }
        }

        return $ordered + $document;
    }

    private static function methodRank(string $method): int
    {
        $rank = array_search($method, ContractRoutes::METHODS, true);

        return $rank === false ? PHP_INT_MAX : $rank;
    }
}
