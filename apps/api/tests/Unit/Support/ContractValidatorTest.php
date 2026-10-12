<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\Contracts\ContractMode;
use App\Support\Contracts\ContractRegistry;
use App\Support\Contracts\ContractUnavailable;
use App\Support\Contracts\ContractValidator;
use App\Support\Contracts\ContractViolation;
use JsonSerializable;
use PHPUnit\Framework\AssertionFailedError;
use PHPUnit\Framework\Attributes\DataProvider;
use stdClass;
use Tests\Support\AssertsContracts;
use Tests\Support\ContractCase;
use Tests\TestCase;

final class ContractValidatorTest extends TestCase
{
    use AssertsContracts;

    /** @var list<string> */
    private array $trees = [];

    protected function tearDown(): void
    {
        foreach ($this->trees as $tree) {
            $this->removeTree($tree);
        }
        ContractRegistry::flush();
        parent::tearDown();
    }

    // The repository's contracts.

    public function test_the_configured_contracts_path_is_the_repository_checkout(): void
    {
        $registry = ContractRegistry::fromConfig();

        $this->assertTrue($registry->enabled(), (string) $registry->problem());
        $this->assertSame(realpath(self::contractsRoot()), realpath($registry->root()));
        $this->assertSame($registry, (new ContractValidator)->registry(), 'one registry per worker');
    }

    public function test_every_fixture_validates_strictly(): void
    {
        $registry = self::contracts();
        $validator = new ContractValidator($registry);
        $checked = 0;
        foreach ($registry->schemaPaths() as $path) {
            $fixture = $registry->root().'/'.substr($path, 0, -strlen('.schema.json')).'.fixture.json';
            if (! is_file($fixture)) {
                continue; // a schema of shared $defs has no fixture; the contract checker enforces the rest
            }
            $checked++;
            $violations = $validator->validateJson($path, (string) file_get_contents($fixture), ContractMode::Strict);
            $this->assertSame([], $this->pairs($violations), "{$path} fixture");
        }
        $this->assertGreaterThan(0, $checked);
    }

    /**
     * @return array<string, array{string, ContractCase}>
     */
    public static function repositoryCases(): array
    {
        $cases = [];
        foreach (self::contracts()->schemaPaths() as $path) {
            if (is_file(self::contractsRoot().'/'.substr($path, 0, -strlen('.schema.json')).'.cases.json')) {
                foreach (self::contractCases($path) as $name => [$case]) {
                    $cases["{$path} {$name}"] = [$path, $case];
                }
            }
        }

        return $cases;
    }

    #[DataProvider('repositoryCases')]
    public function test_every_case_matches_its_verdict_in_both_modes(string $path, ContractCase $case): void
    {
        $validator = new ContractValidator(self::contracts());
        foreach (ContractMode::cases() as $mode) {
            $violations = $validator->validateJson($path, $case->json, $mode);
            $label = "{$case->name} ({$mode->value})";
            if ($case->accepted($mode)) {
                $this->assertSame([], $this->pairs($violations), "{$label} should be accepted");

                continue;
            }
            $expected = $case->error['keyword'].'@'.$case->error['instance_location'];
            $this->assertNotSame([], $violations, "{$label} should fail on {$expected}");
            $this->assertContains($expected, $this->pairs($violations), "{$label} should fail on {$expected}");
        }
    }

    public function test_catalogue_entries_resolve_with_their_reading(): void
    {
        $registry = self::contracts();
        foreach ($registry->entries() as $id => $entry) {
            $this->assertSame($entry['schema'], $registry->schemaPath($id));
            $this->assertSame($entry['reading'], $registry->reading($id)->value);
        }
        $this->assertSame(ContractMode::Tolerant, $registry->reading('internal/catalogue.schema.json'));
    }

    public function test_assert_produced_names_the_contract_keyword_path_and_missing_field(): void
    {
        $entry = [
            'id' => 'device.applied.v1', 'group' => 'event', 'schema' => 'internal/events/device.applied.v1.schema.json',
            'producer' => 'runtime', 'consumer' => 'control_plane', 'dedup' => 'uuid', 'fences' => ['generation'],
            'live_check' => 'control_plane:events', 'producer_tests' => ['a_test.go'], 'consumer_tests' => ['BTest.php'],
        ];
        try {
            $this->assertProduced('internal/catalogue.schema.json', [$entry]);
            $this->fail('a non-conforming value passed');
        } catch (AssertionFailedError $failure) {
            $this->assertStringContainsString('internal/catalogue.schema.json', $failure->getMessage());
            $this->assertStringContainsString('required at /0 (missing reading)', $failure->getMessage());
        }

        $this->assertProduced('internal/catalogue.schema.json', [$entry + ['reading' => 'tolerant']]);
        $this->assertProducedJson('internal/catalogue.schema.json', '[]');
    }

    // Modes and loading, on small trees built per test.

    public function test_strict_reports_unknown_fields_and_tolerant_ignores_only_those(): void
    {
        $path = 'internal/events/thing.counted.v1.schema.json';
        $validator = $this->validator([$path => $this->counter($path)]);

        $this->assertSame(['additionalProperties@'], $this->check($validator, $path, '{"count":1,"added_later":true}', ContractMode::Strict));
        $this->assertSame([], $this->check($validator, $path, '{"count":1,"added_later":true}', ContractMode::Tolerant));
        $this->assertSame(['minimum@/count'], $this->check($validator, $path, '{"count":-1,"added_later":true}', ContractMode::Tolerant));
        $this->assertSame(['required@'], $this->check($validator, $path, '{}', ContractMode::Tolerant));
    }

    public function test_a_failing_declared_property_is_not_reported_as_additional(): void
    {
        // opis/json-schema 2.6.0 lists every property as additional once a declared one fails.
        $path = 'internal/events/thing.counted.v1.schema.json';
        $validator = $this->validator([$path => $this->counter($path)]);

        $this->assertSame(['type@/count'], $this->check($validator, $path, '{"count":"one","note":"n"}', ContractMode::Strict));
        $this->assertSame(['additionalProperties@', 'type@/count'], $this->check($validator, $path, '{"count":"one","extra":1}', ContractMode::Strict));
    }

    /**
     * The tolerant mode must re-evaluate oneOf and anyOf without the unknown-field
     * rules. Filtering additionalProperties out of the strict result is not enough: the
     * oneOf (and the other branch's const failure) would remain.
     */
    public function test_tolerant_recomputes_one_of_and_any_of(): void
    {
        $branch = fn (string $version): array => [
            'type' => 'object',
            'properties' => ['schema_version' => ['const' => $version], 'name' => ['type' => 'string']],
            'required' => ['schema_version', 'name'],
            'additionalProperties' => false,
        ];
        $path = 'internal/control/thing.changed.v1.schema.json';
        $validator = $this->validator([$path => $this->schemaAt($path, [
            'type' => 'object',
            'properties' => [
                'definition' => ['oneOf' => [$branch('thing.v1'), $branch('thing.v2'), ['type' => 'null']]],
                'options' => ['anyOf' => [$branch('options.v1'), ['type' => 'string']]],
            ],
            'required' => ['definition'],
            'additionalProperties' => false,
        ])]);

        $newerField = '{"definition":{"schema_version":"thing.v2","name":"n","added_later":1},"options":{"schema_version":"options.v1","name":"o","added_later":2}}';
        $strict = $validator->validateJson($path, $newerField, ContractMode::Strict);
        foreach (['oneOf@/definition', 'additionalProperties@/definition', 'anyOf@/options', 'additionalProperties@/options'] as $expected) {
            $this->assertContains($expected, $this->pairs($strict));
        }
        $filtered = array_filter($strict, fn (ContractViolation $violation): bool => ! in_array($violation->keyword, ContractRegistry::UNKNOWN_FIELD_KEYWORDS, true));
        $this->assertNotSame([], $filtered, 'dropping leaf errors would leave the oneOf failure behind');
        $this->assertSame([], $this->check($validator, $path, $newerField, ContractMode::Tolerant));

        $tolerant = $this->check($validator, $path, '{"definition":{"schema_version":"thing.v2","added_later":1}}', ContractMode::Tolerant);
        $this->assertContains('oneOf@/definition', $tolerant);
        $this->assertContains('required@/definition', $tolerant);
        $this->assertSame([], array_filter($tolerant, fn (string $pair): bool => str_starts_with($pair, 'additionalProperties@')));
    }

    public function test_tolerant_reading_applies_inside_referenced_files_and_to_unevaluated_properties(): void
    {
        $path = 'internal/events/thing.wrapped.v1.schema.json';
        $validator = $this->validator([
            'alpha/v1/thing.schema.json' => $this->counter('alpha/v1/thing.schema.json'),
            $path => $this->schemaAt($path, [
                'type' => 'object',
                'properties' => ['thing' => ['$ref' => '../../alpha/v1/thing.schema.json']],
                'required' => ['thing'],
                'unevaluatedProperties' => false,
            ]),
        ]);
        $both = '{"thing":{"count":1,"added_later":true},"extra":1}';
        $unevaluated = '{"thing":{"count":1},"extra":1}';

        // opis stops before unevaluatedProperties once another keyword of the object failed.
        $this->assertContains('additionalProperties@/thing', $this->check($validator, $path, $both, ContractMode::Strict));
        $this->assertSame(['unevaluatedProperties@'], $this->check($validator, $path, $unevaluated, ContractMode::Strict));
        $this->assertSame([], $this->check($validator, $path, $both, ContractMode::Tolerant));
        $this->assertSame([], $this->check($validator, $path, $unevaluated, ContractMode::Tolerant));
    }

    /**
     * Every repository schema has an $id since spec 002 T035, so the derived one is
     * proved on a tree: a schema without $id is named by its path, by the $id the
     * checker assumes, and by a relative $ref from another file.
     */
    public function test_a_schema_without_an_id_is_found_by_path_and_derived_id(): void
    {
        $anonymous = $this->counter('alpha/v1/thing.schema.json');
        unset($anonymous['$id']);
        $wrapper = 'internal/events/thing.wrapped.v1.schema.json';
        $validator = $this->validator([
            'alpha/v1/thing.schema.json' => $anonymous,
            $wrapper => $this->schemaAt($wrapper, [
                'type' => 'object',
                'properties' => ['thing' => ['$ref' => '../../alpha/v1/thing.schema.json']],
                'required' => ['thing'],
                'additionalProperties' => false,
            ]),
        ]);

        foreach (['alpha/v1/thing.schema.json', ContractRegistry::ID_BASE.'alpha/v1/thing.schema.json'] as $reference) {
            $this->assertSame([], $this->check($validator, $reference, '{"count":1}', ContractMode::Strict), $reference);
            $this->assertSame(['required@'], $this->check($validator, $reference, '{}', ContractMode::Strict), $reference);
        }
        $this->assertSame(['required@/thing'], $this->check($validator, $wrapper, '{"thing":{}}', ContractMode::Strict));
    }

    public function test_only_the_false_form_in_schema_positions_is_dropped(): void
    {
        $path = 'internal/state/thing.state.v1.schema.json';
        $validator = $this->validator([$path => $this->schemaAt($path, [
            'type' => 'object',
            'properties' => [
                // A property named like the keyword, and a const whose data looks like a schema.
                'additionalProperties' => ['const' => ['additionalProperties' => false]],
                'labels' => ['type' => 'object', 'additionalProperties' => ['type' => 'string']],
            ],
            'required' => ['additionalProperties'],
            'additionalProperties' => false,
        ])]);

        $this->assertSame([], $this->check($validator, $path, '{"additionalProperties":{"additionalProperties":false}}', ContractMode::Tolerant));
        $this->assertSame(['const@/additionalProperties'], $this->check($validator, $path, '{"additionalProperties":{}}', ContractMode::Tolerant));
        $this->assertSame(['type@/labels/a'], $this->check($validator, $path, '{"additionalProperties":{"additionalProperties":false},"labels":{"a":1}}', ContractMode::Tolerant));
    }

    public function test_violations_carry_no_values(): void
    {
        $path = 'internal/state/thing.secret.v1.schema.json';
        $validator = $this->validator([$path => $this->schemaAt($path, [
            'type' => 'object',
            'properties' => [
                'password' => ['type' => 'string', 'maxLength' => 3, '$comment' => 'secret'],
                'uuid' => ['type' => 'string', 'format' => 'uuid'],
            ],
            'required' => ['uuid', 'organization_uuid'],
            'additionalProperties' => false,
        ])]);

        $violations = $validator->validateJson($path, '{"password":"hunter2-placeholder","uuid":"not-a-uuid-value","sneaky-key":"leak-value"}', ContractMode::Strict);

        $this->assertSame(['additionalProperties@', 'required@', 'maxLength@/password', 'format@/uuid'], $this->pairs($violations));
        $encoded = json_encode(array_map(fn (ContractViolation $violation): array => $violation->toArray(), $violations), JSON_THROW_ON_ERROR);
        foreach (['hunter2', 'not-a-uuid', 'sneaky', 'leak-value'] as $value) {
            $this->assertStringNotContainsString($value, $encoded);
        }
        $this->assertStringContainsString('"missing":["organization_uuid"]', $encoded);
    }

    public function test_references_resolve_by_catalogue_id_path_and_id(): void
    {
        $internal = 'internal/events/thing.counted.v1.schema.json';
        $envelope = 'ingestion/v1/thing.envelope.v1.schema.json';
        $unlisted = 'alpha/v1/thing.schema.json';
        $validator = $this->validator([
            $internal => $this->counter($internal),
            $envelope => $this->counter($envelope),
            $unlisted => $this->counter($unlisted),
            'internal/catalogue.json' => [[
                'id' => 'thing.counted.v1', 'group' => 'event', 'schema' => $internal, 'producer' => 'runtime', 'consumer' => 'control_plane',
                'dedup' => 'uuid', 'fences' => [], 'reading' => 'strict', 'live_check' => 'none',
                'producer_tests' => ['x'], 'consumer_tests' => ['y'],
            ]],
        ]);
        $registry = $validator->registry();

        foreach (['thing.counted.v1', $internal, ContractRegistry::ID_BASE.$internal] as $reference) {
            $this->assertSame(['required@'], $this->check($validator, $reference, '{}', ContractMode::Strict), $reference);
        }
        $this->assertSame(ContractMode::Strict, $registry->reading('thing.counted.v1'), 'the catalogue reading wins');
        $this->assertSame(ContractMode::Strict, $registry->reading($envelope), 'ingestion/ is strict when no catalogue lists it');
        $this->assertSame(ContractMode::Tolerant, $registry->reading($unlisted));
        $this->assertSame(['thing.counted.v1'], array_keys($registry->entries()));
        $this->assertCount(3, $registry->schemaPaths());

        $this->expectException(ContractUnavailable::class);
        $validator->validateJson('thing.missing.v1', '{}', ContractMode::Strict);
    }

    public function test_validate_judges_php_values_by_their_json_encoding(): void
    {
        $path = 'alpha/v1/thing.schema.json';
        $validator = $this->validator([$path => $this->counter($path)]);
        $serializable = new class implements JsonSerializable
        {
            public function jsonSerialize(): array
            {
                return ['count' => 3];
            }
        };
        $object = new stdClass;
        $object->count = 2;

        foreach ([['count' => 1], $object, $serializable, ['count' => 4.0]] as $value) {
            $this->assertSame([], $validator->validate($path, $value, ContractMode::Strict));
        }
        $this->assertSame(['minimum@/count'], $this->pairs($validator->validate($path, ['count' => -1], ContractMode::Strict)));
        $this->assertSame(['type@'], $this->pairs($validator->validate($path, [], ContractMode::Strict)), 'an empty PHP array is a JSON array');
    }

    public function test_openapi_and_unchecked_directories_are_skipped(): void
    {
        $path = 'alpha/v1/thing.schema.json';
        $validator = $this->validator([
            $path => $this->counter($path),
            // contracts/openapi has its own gate (php artisan contract:check).
            'openapi/meta/supplement.schema.json' => ['$schema' => 'http://json-schema.org/draft-07/schema#', '$ref' => 'missing.json'],
            'definitions/loose.schema.json' => ['$ref' => 'missing.json'],
        ]);

        $this->assertSame([$path], $validator->registry()->schemaPaths());
    }

    public function test_a_missing_root_yields_a_disabled_registry(): void
    {
        $registry = ContractRegistry::forPath(sys_get_temp_dir().'/iot-contracts-missing-'.bin2hex(random_bytes(6)));

        $this->assertFalse($registry->enabled());
        $this->assertNull($registry->problem(), 'a missing root is not an error');
        $this->assertSame([], $registry->entries());
        $this->expectException(ContractUnavailable::class);
        (new ContractValidator($registry))->validateJson('device.applied.v1', '{}', ContractMode::Tolerant);
    }

    public function test_unreadable_contract_files_disable_the_registry_with_a_problem(): void
    {
        $root = $this->tree(['internal/events/thing.counted.v1.schema.json' => $this->counter('internal/events/thing.counted.v1.schema.json')]);
        file_put_contents($root.'/internal/events/thing.broken.v1.schema.json', '{"type":');
        $registry = ContractRegistry::forPath($root);

        $this->assertFalse($registry->enabled());
        $this->assertStringContainsString('Syntax error', (string) $registry->problem());
    }

    public function test_a_schema_that_does_not_compile_is_reported_as_unavailable(): void
    {
        $path = 'internal/events/thing.broken.v1.schema.json';
        $validator = $this->validator([$path => $this->schemaAt($path, ['$ref' => 'missing.schema.json'])]);

        $this->expectException(ContractUnavailable::class);
        $validator->validateJson($path, '{}', ContractMode::Strict);
    }

    // Helpers.

    /**
     * @param  list<ContractViolation>  $violations
     * @return list<string>
     */
    private function pairs(array $violations): array
    {
        return array_map(fn (ContractViolation $violation): string => $violation->keyword.'@'.$violation->instanceLocation, $violations);
    }

    /**
     * @return list<string>
     */
    private function check(ContractValidator $validator, string $reference, string $json, ContractMode $mode): array
    {
        return $this->pairs($validator->validateJson($reference, $json, $mode));
    }

    /**
     * @param  array<string, mixed>  $files  path under contracts/ => decoded JSON
     */
    private function validator(array $files): ContractValidator
    {
        $registry = ContractRegistry::forPath($this->tree($files));
        $this->assertTrue($registry->enabled(), (string) $registry->problem());

        return new ContractValidator($registry);
    }

    /**
     * @param  array<string, mixed>  $files
     */
    private function tree(array $files): string
    {
        $root = sys_get_temp_dir().'/iot-contracts-'.bin2hex(random_bytes(6));
        $this->trees[] = $root;
        foreach ($files as $path => $value) {
            @mkdir(dirname($root.'/'.$path), 0o755, true);
            file_put_contents($root.'/'.$path, json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
        }

        return $root;
    }

    private function removeTree(string $directory): void
    {
        foreach (glob($directory.'/{,.}[!.]*', GLOB_BRACE) ?: [] as $entry) {
            is_dir($entry) ? $this->removeTree($entry) : unlink($entry);
        }
        @rmdir($directory);
    }

    /**
     * @param  array<string, mixed>  $body
     * @return array<string, mixed>
     */
    private function schemaAt(string $path, array $body): array
    {
        return ['$schema' => ContractRegistry::DIALECT, '$id' => ContractRegistry::ID_BASE.$path] + $body;
    }

    /**
     * A closed object with a required non-negative integer count.
     *
     * @return array<string, mixed>
     */
    private function counter(string $path): array
    {
        return $this->schemaAt($path, [
            'type' => 'object',
            'properties' => ['count' => ['type' => 'integer', 'minimum' => 0], 'note' => ['type' => 'string']],
            'required' => ['count'],
            'additionalProperties' => false,
        ]);
    }
}
