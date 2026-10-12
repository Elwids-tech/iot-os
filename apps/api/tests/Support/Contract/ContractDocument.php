<?php

declare(strict_types=1);

namespace Tests\Support\Contract;

use App\Support\Contract\ContractException;
use App\Support\Contract\ContractRoutes;
use JsonException;
use Opis\JsonSchema\CompliantValidator;
use Opis\JsonSchema\Errors\ErrorFormatter;
use Opis\JsonSchema\Errors\ValidationError;

/**
 * The committed contract (contracts/openapi/openapi.json) as the response checks read it:
 * operations indexed by method and URI template, and a JSON Schema 2020-12 validator
 * (opis, in its standards-compliant mode) that resolves `#/components/...` inside the
 * document and `../<dir>/...` references to the other schemas in contracts/.
 *
 * Every file in contracts/ has the `$id` `https://iot-os.local/contracts/<path>`, so the
 * loader maps that prefix to the contracts directory and registers the document itself
 * at `.../openapi/openapi.json`; relative references then resolve as they do on disk.
 */
final class ContractDocument
{
    public const BASE_URI = 'https://iot-os.local/contracts/';

    private const DOCUMENT_URI = self::BASE_URI.'openapi/openapi.json';

    /** @var array<string, self> loaded documents by path, for the life of the process */
    private static array $loaded = [];

    /** @var array<string, array<string, mixed>> operations keyed `METHOD /path` */
    private array $operations = [];

    /** @var array<string, array{method: string, path: string}> */
    private array $locations = [];

    private readonly CompliantValidator $validator;

    /**
     * @param  array<string, mixed>  $document
     */
    private function __construct(
        private readonly array $document,
        object $raw,
        string $contractsDirectory,
        public readonly string $sha256,
        public readonly string $source,
    ) {
        foreach ($document['paths'] ?? [] as $path => $item) {
            foreach (is_array($item) ? $item : [] as $method => $operation) {
                if (in_array($method, ContractRoutes::METHODS, true) && is_array($operation)) {
                    $key = strtoupper($method).' '.$path;
                    $this->operations[$key] = $operation;
                    $this->locations[$key] = ['method' => $method, 'path' => (string) $path];
                }
            }
        }

        $this->validator = new CompliantValidator(max_errors: 1, stop_at_first_error: true);
        $resolver = $this->validator->loader()->resolver();
        if ($resolver === null) {
            throw new ContractException('The JSON Schema validator has no resolver.');
        }
        $resolver->registerPrefix(self::BASE_URI, rtrim($contractsDirectory, '/'));
        $resolver->registerRaw($raw, self::DOCUMENT_URI);
    }

    /**
     * The contract the suite checks against: contracts/openapi/openapi.json in this
     * checkout (or the image's contracts path), read once per process. It ignores a
     * test's `scramble.contract.directory` override, which points the contract commands
     * at scratch copies.
     */
    public static function committed(): self
    {
        return self::load(rtrim((string) config('devices.contracts_path'), '/').'/openapi/openapi.json');
    }

    public static function load(string $path): self
    {
        $real = realpath($path);
        if ($real === false || ! is_file($real)) {
            throw new ContractException("The contract {$path} is missing; run php artisan contract:export.");
        }

        return self::$loaded[$real] ??= self::fromJson((string) file_get_contents($real), dirname($real, 2), $real);
    }

    /**
     * @param  string  $contractsDirectory  the directory that stands in for contracts/
     */
    public static function fromJson(string $json, string $contractsDirectory, string $source = 'openapi.json'): self
    {
        try {
            $document = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
            $raw = json_decode($json, false, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException $exception) {
            throw new ContractException("{$source} is not valid JSON: {$exception->getMessage()}");
        }
        if (! is_array($document) || ! is_object($raw)) {
            throw new ContractException("{$source} is not an OpenAPI document.");
        }

        return new self($document, $raw, $contractsDirectory, hash('sha256', $json), $source);
    }

    /**
     * The operation for a method and a contract path (`/v1/...`, relative to /api).
     *
     * @return array<string, mixed>|null
     */
    public function operation(string $key): ?array
    {
        return $this->operations[$key] ?? null;
    }

    public function isPending(string $key): bool
    {
        return ($this->operations[$key]['x-schema-status'] ?? null) === 'pending';
    }

    /**
     * The documented response for a status: the exact code, else its range (`2XX`), else
     * `default`. Response `$ref`s are followed.
     *
     * @return array{status: string, response: array<string, mixed>, pointer: string}|null
     */
    public function response(string $key, int $status): ?array
    {
        $responses = $this->operations[$key]['responses'] ?? [];
        $range = intdiv($status, 100).'XX';
        foreach ([(string) $status, $range, strtolower($range), 'default'] as $candidate) {
            if (! array_key_exists($candidate, $responses)) {
                continue;
            }
            $location = $this->locations[$key];
            [$response, $pointer] = $this->follow(
                $responses[$candidate],
                self::pointer(['paths', $location['path'], $location['method'], 'responses', $candidate]),
            );

            return ['status' => $candidate, 'response' => $response, 'pointer' => $pointer];
        }

        return null;
    }

    /**
     * @return list<string> the documented status keys of an operation
     */
    public function statuses(string $key): array
    {
        return array_map('strval', array_keys($this->operations[$key]['responses'] ?? []));
    }

    /**
     * Headers a response documents, with `$ref`s followed: whether each is required and
     * the pointer to its schema. `Content-Type` is left out, as OpenAPI says.
     *
     * @param  array<string, mixed>  $response
     * @return list<array{name: string, required: bool, schema: string|null}>
     */
    public function headers(array $response, string $pointer): array
    {
        $headers = [];
        foreach ($response['headers'] ?? [] as $name => $header) {
            [$header, $headerPointer] = $this->follow($header, $pointer.'/headers/'.self::segment((string) $name));
            if (strtolower((string) $name) === 'content-type') {
                continue;
            }
            $headers[] = [
                'name' => (string) $name,
                'required' => ($header['required'] ?? false) === true,
                'schema' => isset($header['schema']) ? $headerPointer.'/schema' : null,
            ];
        }

        return $headers;
    }

    /**
     * Validates a header value against its schema. Header values are strings on the wire,
     * so a numeric value is also tried as a number (`Retry-After: 30` against an integer).
     *
     * @return string|null null when valid, otherwise the difference
     */
    public function validateHeader(string $value, string $schemaPointer): ?string
    {
        $problems = [];
        foreach (is_numeric($value) ? [$value, $value + 0] : [$value] as $candidate) {
            $problem = $this->validate($candidate, $schemaPointer);
            if ($problem === null) {
                return null;
            }
            $problems[] = preg_replace('#^/: #', '', $problem) ?? $problem;
        }

        // A type mismatch on one reading says less than a bound or pattern on the other.
        foreach ($problems as $problem) {
            if (! str_starts_with($problem, 'expected ')) {
                return $problem;
            }
        }

        return $problems[0];
    }

    /**
     * Validates decoded JSON (objects as stdClass) against the schema at a pointer into
     * this document.
     *
     * @return string|null null when valid, otherwise `<JSON pointer>: <difference>` for the
     *                     first mismatch
     */
    public function validate(mixed $data, string $schemaPointer): ?string
    {
        $result = $this->validator->validate($data, self::DOCUMENT_URI.$schemaPointer);
        $error = $result->error();
        if ($error === null) {
            return null;
        }
        while ($error->subErrors() !== []) {
            $error = $error->subErrors()[0];
        }
        $path = $error->data()->fullPath();

        return ($path === [] ? '/' : '/'.implode('/', array_map(self::escape(...), $path))).': '.self::describe($error);
    }

    /**
     * A URI fragment for a JSON pointer: segments escaped (`~0`, `~1`) and percent-encoded,
     * because paths contain `{` and `}`.
     *
     * @param  list<string|int>  $segments
     */
    public static function pointer(array $segments): string
    {
        return '#/'.implode('/', array_map(static fn (string|int $segment): string => self::segment((string) $segment), $segments));
    }

    private static function segment(string $segment): string
    {
        return rawurlencode(self::escape($segment));
    }

    private static function escape(string|int $segment): string
    {
        return str_replace(['~', '/'], ['~0', '~1'], (string) $segment);
    }

    /**
     * Follows internal `$ref`s (responses and headers can be references).
     *
     * @return array{0: array<string, mixed>, 1: string} the object and its pointer
     */
    private function follow(mixed $node, string $pointer): array
    {
        $seen = [];
        while (is_array($node) && isset($node['$ref']) && is_string($node['$ref'])) {
            $ref = $node['$ref'];
            if (! str_starts_with($ref, '#/') || isset($seen[$ref])) {
                throw new ContractException("{$this->source}: the reference {$ref} at {$pointer} cannot be followed (only internal, acyclic references are supported here).");
            }
            $seen[$ref] = true;
            $segments = array_map(
                static fn (string $segment): string => str_replace(['~1', '~0'], ['/', '~'], $segment),
                explode('/', substr($ref, 2)),
            );
            $node = $this->document;
            foreach ($segments as $segment) {
                if (! is_array($node) || ! array_key_exists($segment, $node)) {
                    throw new ContractException("{$this->source}: the reference {$ref} points to nothing.");
                }
                $node = $node[$segment];
            }
            $pointer = self::pointer($segments);
        }

        return [is_array($node) ? $node : [], $pointer];
    }

    private static function describe(ValidationError $error): string
    {
        $args = $error->args();

        return match ($error->keyword()) {
            'type' => 'expected '.implode(' or ', (array) ($args['expected'] ?? [])).', got '.($args['type'] ?? $error->data()->type()),
            'required' => 'missing required '.(count($args['missing'] ?? []) === 1 ? 'property ' : 'properties ').implode(', ', (array) ($args['missing'] ?? [])),
            'additionalProperties' => 'unexpected '.(count($args['properties'] ?? []) === 1 ? 'property ' : 'properties ').implode(', ', (array) ($args['properties'] ?? [])),
            'const' => 'expected '.json_encode($args['const'] ?? null, JSON_UNESCAPED_SLASHES).', got '.json_encode($error->data()->value(), JSON_UNESCAPED_SLASHES),
            'enum' => json_encode($error->data()->value(), JSON_UNESCAPED_SLASHES).' is not one of the documented values',
            'format' => json_encode($error->data()->value(), JSON_UNESCAPED_SLASHES).' is not a valid '.($args['format'] ?? 'value'),
            default => (new ErrorFormatter)->formatErrorMessage($error),
        };
    }
}
