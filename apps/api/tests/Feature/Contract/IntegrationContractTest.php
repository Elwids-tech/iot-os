<?php

declare(strict_types=1);

namespace Tests\Feature\Contract;

use App\Domain\Devices\Models\Device;
use App\Domain\Geospatial\Models\Geofence;
use App\Domain\Integrations\Models\IntegrationApplication;
use App\Domain\Shared\Models\Organization;
use App\Support\Contract\ContractFiles;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\Contract\ContractDocument;
use Tests\TestCase;

/**
 * The error responses of the 18 integration operations, checked against the contract
 * like every other response (gate G4), so `contract:coverage` sees a 401, 403 and 404
 * for each and a 422 for each that takes input (specs/001-openapi-contract research R8).
 * Success responses are exercised in tests/Feature/Domain/Integrations and Geospatial.
 */
final class IntegrationContractTest extends TestCase
{
    use RefreshDatabase;

    private const BASE = '/api/integration/v1/organizations/';

    private const ABILITIES = ['devices:read', 'alerts:read', 'events:read', 'telemetry:read', 'locations:read', 'geofences:read', 'geofences:manage', 'geofences:activate'];

    /**
     * Every integration operation and the ability its middleware requires.
     */
    private const OPERATIONS = [
        'GET devices' => ['GET', 'devices', 'devices:read'],
        'GET devices/{uuid}' => ['GET', 'devices/{device}', 'devices:read'],
        'GET alerts' => ['GET', 'alerts', 'alerts:read'],
        'GET alerts/{uuid}' => ['GET', 'alerts/{random}', 'alerts:read'],
        'GET events/checkpoint' => ['GET', 'events/checkpoint', 'events:read'],
        'GET events' => ['GET', 'events', 'events:read'],
        'GET devices/{uuid}/telemetry/latest' => ['GET', 'devices/{device}/telemetry/latest', 'telemetry:read'],
        'GET devices/{uuid}/telemetry/history' => ['GET', 'devices/{device}/telemetry/history', 'telemetry:read'],
        'GET devices/{uuid}/telemetry/records' => ['GET', 'devices/{device}/telemetry/records', 'telemetry:read'],
        'GET devices/{uuid}/location-bindings' => ['GET', 'devices/{device}/location-bindings', 'telemetry:read'],
        'GET devices/{uuid}/locations/{event}' => ['GET', 'devices/{device}/locations/{random}', 'telemetry:read'],
        'POST location-map/query' => ['POST', 'location-map/query', 'locations:read'],
        'GET geofences' => ['GET', 'geofences', 'geofences:read'],
        'GET geofences/{uuid}' => ['GET', 'geofences/{fence}', 'geofences:read'],
        'POST geofences' => ['POST', 'geofences', 'geofences:activate'],
        'PUT geofences/{uuid}' => ['PUT', 'geofences/{fence}', 'geofences:activate'],
        'GET geofences/{uuid}/activations/{batch}' => ['GET', 'geofences/{fence}/activations/{random}', 'geofences:read'],
        'POST geofences/{uuid}/activations/{batch}/items/{item}/retry' => ['POST', 'geofences/{fence}/activations/{random}/items/1/retry', 'geofences:activate'],
    ];

    /**
     * Input each operation rejects with 422, for every operation that takes input.
     */
    private const INVALID_INPUT = [
        'GET devices' => ['query' => ['per_page' => 101]],
        'GET alerts' => ['query' => ['condition' => 'open']],
        'GET events' => ['query' => ['limit' => 0]],
        'GET devices/{uuid}/telemetry/history' => ['query' => ['parameter_uuid' => 'not-a-uuid']],
        'GET devices/{uuid}/telemetry/records' => ['query' => []],
        'GET devices/{uuid}/location-bindings' => ['query' => ['per_page' => 0]],
        'GET devices/{uuid}/locations/{event}' => ['query' => []],
        'POST location-map/query' => ['body' => ['device_uuids' => [], 'trail_window' => '2h']],
        'POST geofences' => ['body' => ['name' => 'No geometry']],
        'PUT geofences/{uuid}' => ['body' => ['operation_uuid' => 'not-a-uuid']],
    ];

    private Organization $organization;

    private Organization $otherOrganization;

    private Device $device;

    private Geofence $fence;

    private IntegrationApplication $application;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->otherOrganization = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $this->device = Device::create(['organization_id' => $this->organization->id, 'code' => 'contract', 'name' => 'Contract tag']);
        // No assignments, so the update reaches its validation with any device grant.
        $this->fence = Geofence::create(['organization_id' => $this->organization->id, 'name' => 'Empty fence', 'revision' => 1,
            'geometry' => ['type' => 'Polygon', 'coordinates' => [[[-114.01, 50.99], [-113.99, 50.99], [-113.99, 51.01], [-114.01, 50.99]]]]]);
        $this->application = IntegrationApplication::create(['organization_id' => $this->organization->id, 'name' => 'Contract client',
            'abilities' => self::ABILITIES, 'device_uuids' => [$this->device->uuid]])->fresh();
    }

    /**
     * @return iterable<string, array{0: string}>
     */
    public static function operations(): iterable
    {
        foreach (array_keys(self::OPERATIONS) as $operation) {
            yield $operation => [$operation];
        }
    }

    /**
     * A token without the operation's ability, and for the two compound rules a token
     * with the ability but without its companion.
     *
     * @return iterable<string, array{0: string, 1: list<string>}>
     */
    public static function forbidden(): iterable
    {
        foreach (self::OPERATIONS as $operation => [, , $ability]) {
            yield "{$operation} without {$ability}" => [$operation, array_values(array_diff(self::ABILITIES, [$ability]))];
            if ($ability === 'events:read') {
                yield "{$operation} without alerts:read or geofences:read" => [$operation, array_values(array_diff(self::ABILITIES, ['alerts:read', 'geofences:read']))];
            }
            if ($ability === 'geofences:activate') {
                yield "{$operation} without geofences:manage" => [$operation, array_values(array_diff(self::ABILITIES, ['geofences:manage']))];
            }
        }
    }

    /**
     * @return iterable<string, array{0: string}>
     */
    public static function operationsWithInput(): iterable
    {
        foreach (array_keys(self::INVALID_INPUT) as $operation) {
            yield $operation => [$operation];
        }
    }

    #[DataProvider('operations')]
    public function test_a_request_without_a_token_is_unauthenticated(string $operation): void
    {
        $this->callOperation($operation, null)->assertUnauthorized();
    }

    /**
     * @param  list<string>  $abilities
     */
    #[DataProvider('forbidden')]
    public function test_a_token_without_the_required_abilities_is_forbidden(string $operation, array $abilities): void
    {
        $this->callOperation($operation, $this->token($abilities))->assertForbidden();
    }

    #[DataProvider('operations')]
    public function test_another_organization_is_not_found(string $operation): void
    {
        $this->callOperation($operation, $this->token(self::ABILITIES), $this->otherOrganization)->assertNotFound();
    }

    #[DataProvider('operationsWithInput')]
    public function test_invalid_input_is_rejected(string $operation): void
    {
        $this->callOperation($operation, $this->token(self::ABILITIES), input: self::INVALID_INPUT[$operation])->assertUnprocessable();
    }

    public function test_every_operation_and_input_case_is_listed(): void
    {
        $document = ContractDocument::committed();
        $listed = array_map(static fn (string $operation): string => self::contractKey($operation), array_keys(self::OPERATIONS));
        $contract = array_values(array_filter(
            $this->operationKeys(),
            static fn (string $key): bool => str_contains($key, ' /integration/'),
        ));
        sort($listed);
        sort($contract);

        $this->assertSame($contract, $listed, 'OPERATIONS must list every integration operation in the contract.');
        foreach (array_keys(self::OPERATIONS) as $operation) {
            $takesInput = $this->takesInput($document->operation(self::contractKey($operation)) ?? []);
            $this->assertSame($takesInput, isset(self::INVALID_INPUT[$operation]), "{$operation}: INVALID_INPUT must have a case exactly when the operation takes input.");
        }
    }

    public function test_the_contract_states_the_compound_ability_rules(): void
    {
        $document = ContractDocument::committed();
        foreach (self::OPERATIONS as $operation => [, , $ability]) {
            $abilities = $document->operation(self::contractKey($operation))['x-abilities'] ?? [];
            $expected = match ($ability) {
                'events:read' => ['all' => ['events:read'], 'any_of' => [['alerts:read', 'geofences:read']]],
                'geofences:activate' => ['all' => ['geofences:activate', 'geofences:manage']],
                default => ['all' => [$ability]],
            };

            $this->assertSame($expected, $abilities, "{$operation}: x-abilities");
        }
    }

    /**
     * Examples are the contract's golden fixtures (constitution principle IV): every
     * integration success response and the webhook carry one, and every example,
     * including those of request bodies, matches its schema.
     */
    public function test_every_integration_example_matches_its_schema(): void
    {
        $document = ContractDocument::committed();
        $raw = json_decode((string) file_get_contents(ContractFiles::document()), false, 512, JSON_THROW_ON_ERROR);
        $problems = [];
        foreach ($raw->paths as $path => $item) {
            if (! str_starts_with($path, '/integration/')) {
                continue;
            }
            foreach ($item as $method => $operation) {
                $key = strtoupper($method).' '.$path;
                foreach ($operation->responses as $status => $response) {
                    if (str_starts_with((string) $status, '2')) {
                        array_push($problems, ...$this->exampleProblems($document, "{$key} {$status}", $response, ['paths', $path, $method, 'responses', $status]));
                    }
                }
                if (isset($operation->requestBody)) {
                    array_push($problems, ...$this->exampleProblems($document, "{$key} request body", $operation->requestBody, ['paths', $path, $method, 'requestBody'], required: false));
                }
            }
        }
        foreach ($raw->webhooks as $name => $item) {
            foreach ($item as $method => $operation) {
                array_push($problems, ...$this->exampleProblems($document, "webhook {$name}", $operation->requestBody, ['webhooks', $name, $method, 'requestBody']));
            }
        }

        $this->assertSame([], $problems);
    }

    /**
     * @param  list<string>  $segments  where the response or request body sits in the document
     * @return list<string>
     */
    private function exampleProblems(ContractDocument $document, string $where, object $body, array $segments, bool $required = true): array
    {
        $json = $body->content->{'application/json'} ?? null;
        if ($json === null) {
            return ["{$where}: no application/json content"];
        }
        if (! property_exists($json, 'example')) {
            return $required ? ["{$where}: no example"] : [];
        }
        $problem = $document->validate($json->example, ContractDocument::pointer([...$segments, 'content', 'application/json', 'schema']));

        return $problem === null ? [] : ["{$where}: example {$problem}"];
    }

    /**
     * @param  array{query?: array<string, mixed>, body?: array<string, mixed>}  $input
     */
    private function callOperation(string $operation, ?string $token, ?Organization $organization = null, array $input = []): TestResponse
    {
        [$method, $path] = self::OPERATIONS[$operation];
        $url = self::BASE.($organization ?? $this->organization)->uuid.'/'.strtr($path, [
            '{device}' => $this->device->uuid,
            '{fence}' => $this->fence->uuid,
            '{random}' => (string) Str::uuid(),
        ]);
        if (($input['query'] ?? []) !== []) {
            $url .= '?'.http_build_query($input['query']);
        }
        Auth::forgetGuards();
        $request = $token === null ? $this : $this->withToken($token);

        return $request->json($method, $url, $input['body'] ?? []);
    }

    /**
     * @param  list<string>  $abilities
     */
    private function token(array $abilities): string
    {
        $secret = Str::random(40);
        $token = $this->application->tokens()->create(['name' => 'contract', 'token' => hash('sha256', $secret), 'abilities' => $abilities, 'expires_at' => now()->addDay()]);

        return $token->id.'|'.$secret;
    }

    private static function contractKey(string $operation): string
    {
        [$method, $path] = explode(' ', $operation, 2);

        return "{$method} /integration/v1/organizations/{organization}/{$path}";
    }

    /**
     * @return list<string>
     */
    private function operationKeys(): array
    {
        $raw = json_decode((string) file_get_contents(ContractFiles::document()), true, 512, JSON_THROW_ON_ERROR);
        $keys = [];
        foreach ($raw['paths'] as $path => $item) {
            foreach (array_keys($item) as $method) {
                $keys[] = strtoupper($method).' '.$path;
            }
        }

        return $keys;
    }

    /**
     * Any input the operation validates: a request body or a query parameter. Broader
     * than the coverage rule (a body or a required query parameter), so optional
     * filters and page sizes get a 422 case too.
     *
     * @param  array<string, mixed>  $operation
     */
    private function takesInput(array $operation): bool
    {
        if (isset($operation['requestBody'])) {
            return true;
        }

        return array_filter($operation['parameters'] ?? [], static fn (array $parameter): bool => $parameter['in'] === 'query') !== [];
    }
}
