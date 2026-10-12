<?php

declare(strict_types=1);

namespace App\Support\Contract;

use JsonException;

/**
 * contracts/openapi/pending-schemas.json: operations whose success bodies are not
 * described yet. The list only shrinks (gate G3).
 */
final class PendingSchemas
{
    /**
     * @param  list<array{operation: string, domain: string}>  $entries
     */
    private function __construct(public readonly array $entries) {}

    public static function load(?string $path = null): self
    {
        $path ??= ContractFiles::pendingSchemas();
        if (! is_file($path)) {
            throw new ContractException("The pending-schema list {$path} is missing.");
        }

        return self::fromJson((string) file_get_contents($path), $path);
    }

    public static function fromJson(string $json, string $source = 'pending-schemas.json'): self
    {
        try {
            $raw = ContractJson::decodeObjects($json);
        } catch (JsonException $exception) {
            throw new ContractException("{$source} is not valid JSON: {$exception->getMessage()}");
        }
        $problems = ContractFiles::validate($raw, 'pending-schemas.schema.json');
        if ($problems !== []) {
            throw new ContractException("{$source} does not match meta/pending-schemas.schema.json:\n  ".implode("\n  ", $problems));
        }

        $entries = array_map(
            static fn (object $entry): array => ['operation' => $entry->operation, 'domain' => $entry->domain],
            $raw->operations,
        );

        return new self(array_values($entries));
    }

    /**
     * @return list<string>
     */
    public function operations(): array
    {
        return array_column($this->entries, 'operation');
    }

    public function has(string $operation): bool
    {
        return in_array($operation, $this->operations(), true);
    }

    public function count(): int
    {
        return count($this->entries);
    }

    /**
     * Entries out of order or repeated, in list order.
     *
     * @return list<string>
     */
    public function orderProblems(): array
    {
        $problems = [];
        $operations = $this->operations();
        foreach ($operations as $index => $operation) {
            if ($index > 0 && strcmp($operations[$index - 1], $operation) >= 0) {
                $problems[] = $operations[$index - 1] === $operation
                    ? "{$operation}: listed more than once"
                    : "{$operation}: out of order (after {$operations[$index - 1]}); the list is sorted by operation";
            }
        }

        return $problems;
    }
}
