<?php

declare(strict_types=1);

namespace App\Support\Contracts;

use FilesystemIterator;
use JsonException;
use Opis\JsonSchema\CompliantValidator;
use Opis\JsonSchema\Resolvers\SchemaResolver;
use Opis\JsonSchema\SchemaLoader;
use Opis\JsonSchema\Validator;
use RecursiveCallbackFilterIterator;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use SplFileInfo;
use stdClass;

/**
 * The message contracts under a contracts root (contracts/README.md, ADR-015).
 *
 * It reads both catalogues (contracts/internal/catalogue.json and
 * contracts/ingestion/v1/catalogue.json) and every schema the contract checker
 * (tooling/verify-devices-contracts.py) checks: each *.schema.json under a v<N>/
 * directory or contracts/internal/, never contracts/openapi/ (checked by
 * `php artisan contract:check`). `$ref` resolves across files by `$id`; a schema
 * without one gets https://iot-os.local/contracts/<path>.
 *
 * Each mode has its own validator. The tolerant one is given copies of the schemas
 * without the boolean `false` form of additionalProperties and
 * unevaluatedProperties, so oneOf, anyOf, not and if are evaluated again without the
 * unknown-field rules rather than having their errors filtered afterwards (the
 * Python checker's tolerant validator works the same way).
 *
 * One instance per contracts root is kept for the life of the PHP process, so a
 * worker parses each schema once. A missing root gives a disabled registry, never an
 * error; a root whose files cannot be read gives a disabled registry with a problem.
 */
final class ContractRegistry
{
    public const ID_BASE = 'https://iot-os.local/contracts/';

    public const DIALECT = 'https://json-schema.org/draft/2020-12/schema';

    /** Keywords tolerant readers ignore (FR-030); only their `false` form is an unknown-field rule. */
    public const UNKNOWN_FIELD_KEYWORDS = ['additionalProperties', 'unevaluatedProperties'];

    /** Under these keywords the keys are names, not keywords. */
    private const NAMED_CHILDREN = ['properties', 'patternProperties', '$defs', 'dependentSchemas'];

    /** Under these keywords the values are instances, not schemas. */
    private const DATA_KEYWORDS = ['const', 'enum', 'examples', 'default'];

    /** Errors gathered per keyword before a validator stops collecting. */
    private const MAX_ERRORS = 50;

    /** @var array<string, self> */
    private static array $instances = [];

    private bool $enabled = false;

    private ?string $problem = null;

    /** @var array<string, array<string, mixed>> catalogue entries by contract id */
    private array $entries = [];

    /** @var array<string, string> schema id by path under contracts/ */
    private array $paths = [];

    /** @var array<string, string> path under contracts/ by schema id */
    private array $ids = [];

    /** @var array<string, object> decoded schema by schema id */
    private array $documents = [];

    /** @var array<string, Validator> */
    private array $validators = [];

    private function __construct(private readonly string $root)
    {
        if (! is_dir($root)) {
            return;
        }
        try {
            $this->load();
            $this->enabled = true;
        } catch (ContractUnavailable|JsonException $exception) {
            $this->entries = $this->paths = $this->ids = $this->documents = [];
            $this->problem = $exception->getMessage();
        }
    }

    /**
     * The registry for `config('devices.contracts_path')`: the repository checkout
     * locally, /var/contracts in images.
     */
    public static function fromConfig(): self
    {
        return self::forPath((string) config('devices.contracts_path'));
    }

    public static function forPath(string $root): self
    {
        $root = rtrim($root, '/');
        $key = realpath($root) ?: $root;

        return self::$instances[$key] ??= new self($root);
    }

    /**
     * Forgets every loaded registry, for tests that change contract files.
     */
    public static function flush(): void
    {
        self::$instances = [];
    }

    public function enabled(): bool
    {
        return $this->enabled;
    }

    /**
     * Why an existing contracts root could not be loaded, or null.
     */
    public function problem(): ?string
    {
        return $this->problem;
    }

    public function root(): string
    {
        return $this->root;
    }

    /**
     * Catalogue entries of both catalogues, ordered by id.
     *
     * @return array<string, array<string, mixed>>
     */
    public function entries(): array
    {
        $entries = $this->entries;
        ksort($entries, SORT_STRING);

        return $entries;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function entry(string $id): ?array
    {
        return $this->entries[$id] ?? null;
    }

    /**
     * Paths under contracts/ of every schema, sorted.
     *
     * @return list<string>
     */
    public function schemaPaths(): array
    {
        $paths = array_keys($this->paths);
        sort($paths, SORT_STRING);

        return $paths;
    }

    /**
     * The `$id` for a reference: a catalogue id (device.applied.v1), a schema path
     * under contracts/ (devices/v1/command.schema.json) or a schema `$id`.
     */
    public function schemaId(string $reference): string
    {
        if (! $this->enabled) {
            throw new ContractUnavailable("Contracts are disabled ({$this->describeRoot()}); cannot check {$reference}.");
        }
        $reference = $this->entries[$reference]['schema'] ?? $reference;
        $id = $this->paths[$reference] ?? $reference;
        if (! isset($this->documents[$id])) {
            throw new ContractUnavailable("Unknown contract {$reference}.");
        }

        return $id;
    }

    public function schemaPath(string $reference): string
    {
        return $this->ids[$this->schemaId($reference)];
    }

    /**
     * How a contract is read: its catalogue `reading`, otherwise strict under
     * ingestion/ and tolerant elsewhere, as the contract checker judges schemas no
     * catalogue lists.
     */
    public function reading(string $reference): ContractMode
    {
        $path = $this->schemaPath($reference);
        foreach ($this->entries as $entry) {
            if ($entry['schema'] === $path) {
                return ContractMode::from($entry['reading']);
            }
        }

        return str_starts_with($path, 'ingestion/') ? ContractMode::Strict : ContractMode::Tolerant;
    }

    /**
     * The validator for a mode, built on first use with every schema registered.
     */
    public function validator(ContractMode $mode): Validator
    {
        if (! $this->enabled) {
            throw new ContractUnavailable("Contracts are disabled ({$this->describeRoot()}).");
        }
        if (isset($this->validators[$mode->value])) {
            return $this->validators[$mode->value];
        }
        $resolver = new SchemaResolver;
        foreach ($this->documents as $id => $document) {
            $resolver->registerRaw($mode === ContractMode::Tolerant ? self::withoutUnknownFieldRules($document) : $document, $id);
        }

        return $this->validators[$mode->value] = new CompliantValidator(new SchemaLoader(null, $resolver), self::MAX_ERRORS, false);
    }

    private function describeRoot(): string
    {
        return $this->problem === null ? "no contracts at {$this->root}" : $this->problem;
    }

    private function load(): void
    {
        $schemas = $catalogues = [];
        $directories = new RecursiveDirectoryIterator($this->root, FilesystemIterator::SKIP_DOTS);
        $skipOpenApi = new RecursiveCallbackFilterIterator($directories, fn (SplFileInfo $file): bool => ! ($file->isDir() && $this->relative($file) === 'openapi'));
        foreach (new RecursiveIteratorIterator($skipOpenApi) as $file) {
            /** @var SplFileInfo $file */
            $relative = $this->relative($file);
            if (str_ends_with($relative, '.schema.json') && self::checked(dirname($relative))) {
                $schemas[] = $relative;
            } elseif (basename($relative) === 'catalogue.json') {
                $catalogues[] = $relative;
            }
        }
        sort($schemas, SORT_STRING);
        sort($catalogues, SORT_STRING);

        foreach ($schemas as $relative) {
            $document = json_decode($this->read($relative), false, 512, JSON_THROW_ON_ERROR);
            if (! $document instanceof stdClass) {
                throw new ContractUnavailable("{$relative}: a schema is a JSON object.");
            }
            if (isset($document->{'$schema'}) && $document->{'$schema'} !== self::DIALECT) {
                throw new ContractUnavailable("{$relative}: \$schema must be ".self::DIALECT.'.');
            }
            $id = is_string($document->{'$id'} ?? null) ? $document->{'$id'} : self::ID_BASE.$relative;
            if (isset($this->ids[$id])) {
                throw new ContractUnavailable("{$relative}: \$id {$id} is also used by {$this->ids[$id]}.");
            }
            $this->documents[$id] = $document;
            $this->paths[$relative] = $id;
            $this->ids[$id] = $relative;
        }

        foreach ($catalogues as $relative) {
            $catalogue = json_decode($this->read($relative), true, 512, JSON_THROW_ON_ERROR);
            if (! is_array($catalogue) || ! array_is_list($catalogue)) {
                throw new ContractUnavailable("{$relative}: a catalogue is a JSON array.");
            }
            foreach ($catalogue as $entry) {
                $id = is_array($entry) ? ($entry['id'] ?? null) : null;
                if (! is_string($id)) {
                    throw new ContractUnavailable("{$relative}: every entry has an id.");
                }
                if (isset($this->entries[$id])) {
                    throw new ContractUnavailable("{$relative}: {$id} is listed more than once.");
                }
                if (! isset($this->paths[$entry['schema'] ?? ''])) {
                    throw new ContractUnavailable("{$relative}: {$id} names a schema that does not exist.");
                }
                if (ContractMode::tryFrom((string) ($entry['reading'] ?? '')) === null) {
                    throw new ContractUnavailable("{$relative}: {$id} has no reading of strict or tolerant.");
                }
                $this->entries[$id] = $entry;
            }
        }
    }

    private function relative(SplFileInfo $file): string
    {
        return str_replace(DIRECTORY_SEPARATOR, '/', substr($file->getPathname(), strlen($this->root) + 1));
    }

    private function read(string $relative): string
    {
        $contents = @file_get_contents($this->root.'/'.$relative);
        if ($contents === false) {
            throw new ContractUnavailable("{$relative}: cannot be read.");
        }

        return $contents;
    }

    /**
     * The contract checker's discovery rule: contracts live under a v<N>/ directory
     * or contracts/internal/.
     */
    private static function checked(string $directory): bool
    {
        $parts = explode('/', $directory);
        if ($parts[0] === 'internal') {
            return true;
        }
        foreach ($parts as $part) {
            if (preg_match('/^v[0-9]+$/', $part) === 1) {
                return true;
            }
        }

        return false;
    }

    /**
     * A copy of a schema document without `additionalProperties: false` and
     * `unevaluatedProperties: false`. `$names` marks the object under properties,
     * patternProperties, $defs or dependentSchemas, whose keys are names.
     */
    private static function withoutUnknownFieldRules(mixed $node, bool $names = false): mixed
    {
        if (is_array($node)) {
            return array_map(fn (mixed $child): mixed => self::withoutUnknownFieldRules($child), $node);
        }
        if (! $node instanceof stdClass) {
            return $node;
        }
        $copy = new stdClass;
        foreach (get_object_vars($node) as $key => $child) {
            $key = (string) $key;
            if ($names) {
                $copy->{$key} = self::withoutUnknownFieldRules($child);
            } elseif (in_array($key, self::UNKNOWN_FIELD_KEYWORDS, true) && $child === false) {
                continue;
            } elseif (in_array($key, self::DATA_KEYWORDS, true)) {
                $copy->{$key} = $child;
            } else {
                $copy->{$key} = self::withoutUnknownFieldRules($child, in_array($key, self::NAMED_CHILDREN, true));
            }
        }

        return $copy;
    }
}
