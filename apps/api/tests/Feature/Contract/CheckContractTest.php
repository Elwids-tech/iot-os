<?php

declare(strict_types=1);

namespace Tests\Feature\Contract;

use App\Support\Contract\ContractJson;
use Tests\TestCase;

/**
 * Gate G3, the pending-schema ratchet (specs/001-openapi-contract/contracts/ci-gate.md).
 */
final class CheckContractTest extends TestCase
{
    use UsesContractCopy;

    public function test_the_committed_contract_passes(): void
    {
        $this->artisan('contract:check')->assertExitCode(0);
    }

    public function test_an_unlisted_operation_with_an_open_body_fails(): void
    {
        $this->rewritePending(static fn (array $entries): array => array_values(array_filter(
            $entries,
            static fn (array $entry): bool => $entry['operation'] !== 'GET /v1/me',
        )));

        $this->artisan('contract:check')
            ->expectsOutputToContain('contract G3: GET /v1/me: open response schema at 200 application/json')
            ->assertExitCode(1);
    }

    public function test_a_listed_operation_that_does_not_exist_fails(): void
    {
        $this->rewritePending(static function (array $entries): array {
            $entries[] = ['operation' => 'GET /v1/zz-invented', 'domain' => 'Overview'];

            return $entries;
        });

        $this->artisan('contract:check')
            ->expectsOutputToContain('contract G3: GET /v1/zz-invented: listed in pending-schemas.json but there is no such operation')
            ->assertExitCode(1);
    }

    public function test_an_unsorted_list_fails(): void
    {
        $this->rewritePending(static fn (array $entries): array => array_reverse($entries));

        $this->artisan('contract:check')
            ->expectsOutputToContain('out of order')
            ->assertExitCode(1);
    }

    public function test_listed_integration_operations_fail_once_the_rule_is_on(): void
    {
        $this->useContractCopy();
        config(['scramble.contract.forbid_pending_integration' => true]);

        $this->artisan('contract:check')
            ->expectsOutputToContain('integration operations must be fully described, never pending')
            ->assertExitCode(1);
    }

    /**
     * @param  callable(list<array{operation: string, domain: string}>): list<array{operation: string, domain: string}>  $change
     */
    private function rewritePending(callable $change): void
    {
        $path = $this->useContractCopy().'/pending-schemas.json';
        $pending = ContractJson::decode((string) file_get_contents($path));
        $pending['operations'] = $change($pending['operations']);
        file_put_contents($path, ContractJson::encode($pending));
    }
}
