<?php

declare(strict_types=1);

namespace Tests\Feature\Contract;

use App\Support\Contract\ContractFiles;
use App\Support\Contract\ContractJson;
use Tests\TestCase;

/**
 * `contract:coverage`, the coverage half of gate G4 (specs/001-openapi-contract research
 * R8). Each test writes its own record; the suite's real record is left alone.
 */
final class ContractCoverageTest extends TestCase
{
    use UsesContractCopy;

    private const DEVICES = 'GET /integration/v1/organizations/{organization}/devices';

    private const LOCATION_MAP = 'POST /integration/v1/organizations/{organization}/location-map/query';

    public function test_an_empty_record_passes_while_nothing_is_required(): void
    {
        $this->onlyIntegrationDescribed();
        config(['scramble.contract.require_integration_coverage' => false]);

        $this->artisan('contract:coverage', ['--file' => $this->record([])])
            ->expectsOutputToContain('0 required pairs, all checked.')
            ->expectsOutputToContain('Integration pairs are not required')
            ->assertExitCode(0);
    }

    public function test_an_empty_record_misses_every_integration_pair(): void
    {
        $this->onlyIntegrationDescribed();
        // 18 operations need a 2xx, 401, 403 and 404; the 6 with a body or a required
        // query parameter also need a 422.
        $this->artisan('contract:coverage', ['--file' => $this->record([])])
            ->expectsOutputToContain('contract G4: '.self::LOCATION_MAP.' 422: never checked by the suite')
            ->expectsOutputToContain('78 required pairs, 78 never checked.')
            ->assertExitCode(1);
    }

    public function test_a_missing_record_fails(): void
    {
        $this->artisan('contract:coverage', ['--file' => sys_get_temp_dir().'/no-such-contract-coverage.json'])
            ->expectsOutputToContain('contract G4: coverage: no coverage record at')
            ->assertExitCode(1);
    }

    public function test_a_record_written_against_another_contract_fails(): void
    {
        $file = $this->record([[self::DEVICES, 200]], sha256: str_repeat('0', 64));

        $this->artisan('contract:coverage', ['--file' => $file])
            ->expectsOutputToContain('contract G4: coverage: the record was written against a different openapi.json')
            ->assertExitCode(1);
    }

    public function test_a_fully_described_operation_needs_a_checked_success_response(): void
    {
        $this->describe('GET /v1/me');

        $this->artisan('contract:coverage', ['--file' => $this->record([['GET /v1/me', 401]])])
            ->expectsOutputToContain('contract G4: GET /v1/me 2xx: no success response was checked')
            ->assertExitCode(1);
    }

    public function test_a_checked_success_response_covers_a_fully_described_operation(): void
    {
        $this->onlyIntegrationDescribed();
        config(['scramble.contract.require_integration_coverage' => false]);
        $this->describe('GET /v1/me');

        $this->artisan('contract:coverage', ['--file' => $this->record([['GET /v1/me', 200]])])
            ->expectsOutputToContain('1 required pairs, all checked.')
            ->assertExitCode(0);
    }

    public function test_integration_operations_need_a_success_401_403_404_and_422_with_input(): void
    {
        $file = $this->record([
            [self::DEVICES, 200], [self::DEVICES, 401], [self::DEVICES, 403],
            [self::LOCATION_MAP, 200], [self::LOCATION_MAP, 401], [self::LOCATION_MAP, 403], [self::LOCATION_MAP, 404],
        ]);

        $this->artisan('contract:coverage', ['--file' => $file])
            ->expectsOutputToContain('contract G4: '.self::DEVICES.' 404: never checked by the suite')
            ->expectsOutputToContain('contract G4: '.self::LOCATION_MAP.' 422: never checked by the suite')
            ->doesntExpectOutputToContain('contract G4: '.self::DEVICES.' 422')
            ->doesntExpectOutputToContain('contract G4: '.self::DEVICES.' 2xx')
            ->assertExitCode(1);
    }

    public function test_opt_outs_are_counted_and_listed_with_their_reasons(): void
    {
        $this->onlyIntegrationDescribed();
        config(['scramble.contract.require_integration_coverage' => false]);
        $file = $this->record([], skipped: [['test' => 'Tests\\Feature\\ExampleTest::test_teapot', 'reason' => 'Returns 418 on purpose.']]);

        $this->artisan('contract:coverage', ['--file' => $file])
            ->expectsOutputToContain('1 test(s) opted out with #[WithoutContractCheck]:')
            ->expectsOutputToContain('Tests\\Feature\\ExampleTest::test_teapot: Returns 418 on purpose.')
            ->assertExitCode(0);
    }

    /**
     * Takes an operation off the pending list in a copy of the contract, as a domain pull
     * request does (the coverage command reads only openapi.json).
     */
    private function describe(string $operation): void
    {
        $path = $this->copiedDocument();
        $document = ContractJson::decode((string) file_get_contents($path));
        [$method, $uri] = explode(' ', $operation, 2);
        unset($document['paths'][$uri][strtolower($method)]['x-schema-status']);
        file_put_contents($path, ContractJson::encode($document));
    }

    /**
     * Marks every operation outside the integration API pending in the copy, so a test
     * counts only the pairs it sets up, however many tenant operations are described.
     */
    private function onlyIntegrationDescribed(): void
    {
        $path = $this->copiedDocument();
        $document = ContractJson::decode((string) file_get_contents($path));
        foreach ($document['paths'] as $uri => $operations) {
            if (str_starts_with($uri, '/integration/')) {
                continue;
            }
            foreach (array_keys($operations) as $method) {
                if (in_array($method, ['get', 'post', 'put', 'patch', 'delete'], true)) {
                    $document['paths'][$uri][$method]['x-schema-status'] = 'pending';
                }
            }
        }
        file_put_contents($path, ContractJson::encode($document));
    }

    private function copiedDocument(): string
    {
        return ($this->contractCopy === null ? $this->useContractCopy() : $this->contractCopy.'/openapi').'/openapi.json';
    }

    /**
     * @param  list<array{0: string, 1: int}>  $checked
     * @param  list<array{test: string, reason: string}>  $skipped
     */
    private function record(array $checked, array $skipped = [], ?string $sha256 = null): string
    {
        $file = tempnam(sys_get_temp_dir(), 'contract-coverage-');
        $this->beforeApplicationDestroyed(static fn () => @unlink($file));
        file_put_contents($file, (string) json_encode([
            'contract_sha256' => $sha256 ?? hash_file('sha256', ContractFiles::document()),
            'checked' => array_map(static fn (array $pair): array => ['operation' => $pair[0], 'status' => $pair[1], 'test' => self::class.'::fixture'], $checked),
            'skipped' => $skipped,
        ]));

        return $file;
    }
}
