<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Support\Contracts\ContractMode;
use App\Support\Contracts\ContractRegistry;
use App\Support\Contracts\ContractValidator;
use App\Support\Contracts\ContractViolation;
use LogicException;

/**
 * Contract assertions for tests (contracts/README.md, ADR-015). They read the
 * repository's contracts/ directory, so they judge the checked-in contracts and work
 * in static data providers, before the application boots.
 */
trait AssertsContracts
{
    protected static function contractsRoot(): string
    {
        return dirname(__DIR__, 4).'/contracts';
    }

    protected static function contracts(): ContractRegistry
    {
        $registry = ContractRegistry::forPath(self::contractsRoot());
        if (! $registry->enabled()) {
            throw new LogicException('The repository contracts did not load: '.($registry->problem() ?? 'no contracts at '.self::contractsRoot()));
        }

        return $registry;
    }

    /**
     * Fails unless a produced value conforms to the contract as written (strict): a
     * producer must not send undeclared fields. The value is judged by its JSON
     * encoding; use assertProducedJson() for a raw body, where empty objects matter.
     * The failure names the contract and each failing keyword and data path, with the
     * missing property names of a required failure.
     *
     * @param  string  $id  catalogue id, schema path under contracts/ or schema $id
     */
    protected function assertProduced(string $id, mixed $value, string $message = ''): void
    {
        $this->assertConforms($id, (new ContractValidator(self::contracts()))->validate($id, $value, ContractMode::Strict), $message);
    }

    protected function assertProducedJson(string $id, string $json, string $message = ''): void
    {
        $this->assertConforms($id, (new ContractValidator(self::contracts()))->validateJson($id, $json, ContractMode::Strict), $message);
    }

    /**
     * The contract's fixture followed by every entry of its cases file, keyed by name
     * for use as a data provider: `return self::contractCases('device.applied.v1');`.
     *
     * @return array<string, array{ContractCase}>
     */
    protected static function contractCases(string $id): array
    {
        $registry = self::contracts();
        $stem = $registry->root().'/'.substr($registry->schemaPath($id), 0, -strlen('.schema.json'));
        $fixture = json_decode((string) file_get_contents($stem.'.fixture.json'), false, 512, JSON_THROW_ON_ERROR);
        $cases = ['fixture' => [new ContractCase('fixture', 'golden fixture', self::encode($fixture), true)]];
        if (! is_file($stem.'.cases.json')) {
            return $cases;
        }
        $entries = json_decode((string) file_get_contents($stem.'.cases.json'), false, 512, JSON_THROW_ON_ERROR);
        foreach ($entries as $index => $entry) {
            $name = "cases[{$index}] {$entry->description}";
            $error = isset($entry->error) ? (array) $entry->error : null;
            if (! $entry->valid && $error === null) {
                throw new LogicException("{$id}: {$name} is invalid but names no error.");
            }
            $cases[$name] = [new ContractCase($name, $entry->description, self::encode($entry->data), $entry->valid, (bool) ($entry->tolerant_valid ?? false), $error)];
        }

        return $cases;
    }

    /**
     * @param  list<ContractViolation>  $violations
     */
    private function assertConforms(string $id, array $violations, string $message): void
    {
        if ($violations !== []) {
            $lines = array_map(fn (ContractViolation $violation): string => '  - '.$violation, $violations);
            $this->fail(trim($message."\nProduced value does not conform to {$id}:\n".implode("\n", $lines)));
        }
        $this->addToAssertionCount(1);
    }

    private static function encode(mixed $decoded): string
    {
        return json_encode($decoded, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
    }
}
