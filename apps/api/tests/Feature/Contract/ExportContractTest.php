<?php

declare(strict_types=1);

namespace Tests\Feature\Contract;

use App\Support\Contract\ContractException;
use App\Support\Contract\ContractExporter;
use App\Support\Contract\ContractJson;
use Illuminate\Routing\Router;
use Illuminate\Support\Facades\Process;
use Tests\TestCase;

/**
 * Gate G1's export (specs/001-openapi-contract/contracts/ci-gate.md).
 */
final class ExportContractTest extends TestCase
{
    use UsesContractCopy;

    /**
     * Separate processes, as in CI: Scramble caches its analysis for the life of a process.
     */
    public function test_two_exports_are_byte_identical_and_describe_only_public_routes(): void
    {
        $copy = $this->useContractCopy();
        $first = $this->exportInChildProcess($copy);
        $second = $this->exportInChildProcess($copy);

        $this->assertSame($first, $second);
        $paths = array_keys(ContractJson::decode($first)['paths']);
        $this->assertNotEmpty($paths);
        $this->assertSame([], array_values(array_filter($paths, static fn (string $path): bool => str_contains($path, '/internal/'))));
        $this->assertSame([], array_values(array_filter($paths, static fn (string $path): bool => ! preg_match('#^/(v1|integration/v1)/#', $path))));
    }

    public function test_a_supplement_key_that_matches_no_operation_fails_the_export(): void
    {
        $copy = $this->useContractCopy();
        file_put_contents($copy.'/supplements/zz-invented.yaml', <<<'YAML'
            operations:
              GET /v1/organizations/{organization}/invented:
                summary: An operation no route serves
            YAML);

        $this->expectException(ContractException::class);
        $this->expectExceptionMessage('"GET /v1/organizations/{organization}/invented" matches no generated operation');

        app(ContractExporter::class)->export();
    }

    public function test_a_supplement_cannot_replace_an_inferred_request_body(): void
    {
        $copy = $this->useContractCopy();
        file_put_contents($copy.'/supplements/zz-body.yaml', <<<'YAML'
            operations:
              POST /integration/v1/organizations/{organization}/location-map/query:
                requestBody:
                  content:
                    application/json:
                      schema:
                        type: object
            YAML);

        $this->expectException(ContractException::class);
        $this->expectExceptionMessage('already has a request body inferred from its validation rules');

        app(ContractExporter::class)->export();
    }

    public function test_check_mode_names_an_operation_edited_by_hand(): void
    {
        $copy = $this->useContractCopy();
        $document = ContractJson::decode((string) file_get_contents($copy.'/openapi.json'));
        $document['paths']['/v1/me']['get']['summary'] = 'Edited by hand';
        file_put_contents($copy.'/openapi.json', ContractJson::encode($document));

        $this->artisan('contract:export', ['--check' => true])
            ->expectsOutputToContain('contract G1: GET /v1/me: changed')
            ->assertExitCode(1);
    }

    private function exportInChildProcess(string $copy): string
    {
        unlink($copy.'/openapi.json');
        Process::path(base_path())
            ->env(['IOT_CONTRACTS_PATH' => dirname($copy)])
            ->timeout(300)
            ->run([PHP_BINARY, 'artisan', 'contract:export'])
            ->throw();

        return (string) file_get_contents($copy.'/openapi.json');
    }

    public function test_scramble_documentation_routes_are_not_registered(): void
    {
        $uris = array_map(static fn ($route): string => $route->uri(), app(Router::class)->getRoutes()->getRoutes());

        $this->assertNotContains('docs/api', $uris);
        $this->assertNotContains('docs/api.json', $uris);
        $this->assertSame([], array_values(array_filter($uris, static fn (string $uri): bool => str_starts_with($uri, '_scramble'))));
        $this->get('/docs/api')->assertNotFound();
    }
}
