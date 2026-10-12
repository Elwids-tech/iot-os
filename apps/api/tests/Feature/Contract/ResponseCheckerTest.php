<?php

declare(strict_types=1);

namespace Tests\Feature\Contract;

use App\Support\Contract\ContractFiles;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Routing\Route;
use Illuminate\Support\Facades\Route as Router;
use PHPUnit\Framework\AssertionFailedError;
use Symfony\Component\HttpFoundation\Response as SymfonyResponse;
use Tests\Support\Contract\CheckedResponse;
use Tests\Support\Contract\ContractDocument;
use Tests\Support\Contract\ResponseChecker;
use Tests\Support\Contract\WithoutContractCheck;
use Tests\TestCase;

/**
 * Gate G4 per response (specs/001-openapi-contract/contracts/ci-gate.md), against a small
 * contract whose operations are fully described, plus the suite-wide hook in
 * Tests\TestCase against the committed contract.
 */
final class ResponseCheckerTest extends TestCase
{
    private const THING = 'api/v1/organizations/{organization}/things/{thing}';

    private const UUID = '6f1c3a52-6d0e-4a3e-9d6e-2a9b1f0e3c11';

    public function test_a_response_that_matches_the_described_schema_passes(): void
    {
        $checked = $this->check('GET', self::THING, new JsonResponse(['data' => ['uuid' => self::UUID, 'created_by' => 7, 'name' => null, 'extra' => true]]));

        $this->assertSame('GET /v1/organizations/{organization}/things/{thing}', $checked?->operation);
        $this->assertSame([], $checked->failures);
    }

    public function test_a_field_of_the_wrong_type_fails_naming_the_operation_status_and_pointer(): void
    {
        $checked = $this->check('GET', self::THING, new JsonResponse(['data' => ['uuid' => self::UUID, 'created_by' => '7', 'name' => 'Pump']]));

        $this->assertSame(
            "contract G4: GET /v1/organizations/{organization}/things/{thing} 200: /data/created_by: expected integer, got string\n"
            .'  fix: correct the response in contracts/openapi/supplements/<domain>.yaml and run php artisan contract:export; the platform is right, the contract follows it (record it in specs/001-openapi-contract/drift-log.md)',
            $checked?->failures[0],
        );
    }

    public function test_a_missing_required_field_fails_even_when_the_schema_gives_it_a_default(): void
    {
        $checked = $this->check('GET', self::THING, new JsonResponse(['data' => ['uuid' => self::UUID, 'created_by' => 7]]));

        $this->assertStringContainsString('200: /data: missing required property name', $checked?->failures[0] ?? '');
    }

    public function test_an_invalid_format_and_a_closed_object_fail(): void
    {
        $format = $this->check('GET', self::THING, new JsonResponse(['data' => ['uuid' => 'not-a-uuid', 'created_by' => 7, 'name' => null]]));
        $closed = $this->check('GET', self::THING, new JsonResponse(['data' => ['uuid' => self::UUID, 'created_by' => 7, 'name' => null], 'surprise' => 1]));

        $this->assertStringContainsString('/data/uuid: "not-a-uuid" is not a valid uuid', $format?->failures[0] ?? '');
        $this->assertStringContainsString('200: /: unexpected property surprise', $closed?->failures[0] ?? '');
    }

    public function test_an_undocumented_status_fails(): void
    {
        $checked = $this->check('GET', self::THING, new JsonResponse(['message' => 'Server Error'], 500));

        $this->assertStringStartsWith(
            'contract G4: GET /v1/organizations/{organization}/things/{thing} 500: status not documented (documented: 200, 404, 429)',
            $checked?->failures[0] ?? '',
        );
    }

    public function test_status_ranges_and_default_responses_count_as_documented(): void
    {
        $this->assertSame([], $this->check('GET', 'api/v1/ranges', new JsonResponse(['message' => 'Unavailable'], 503))?->failures);
        $this->assertSame([], $this->check('GET', 'api/v1/ranges', new JsonResponse(['message' => 'Teapot'], 418))?->failures);
        $this->assertNotSame([], $this->check('GET', 'api/v1/ranges', new JsonResponse(['message' => 1], 418))?->failures);
    }

    public function test_a_pending_operation_gets_the_status_check_only(): void
    {
        $this->assertSame([], $this->check('GET', 'api/v1/pending', new JsonResponse(['anything' => ['goes' => 1]]))?->failures);
        $this->assertSame([], $this->check('GET', 'api/v1/pending', new Response('', 204))?->failures, 'an empty success body is not checked');
        $this->assertSame([], $this->check('GET', 'api/v1/pending', new JsonResponse(['no message' => true], 404))?->failures, 'error bodies of pending operations are not checked');
        $this->assertStringContainsString('GET /v1/pending 409: status not documented', $this->check('GET', 'api/v1/pending', new JsonResponse([], 409))?->failures[0] ?? '');
    }

    public function test_a_documented_required_header_must_be_present(): void
    {
        $missing = $this->check('GET', self::THING, new JsonResponse(['message' => 'Too Many Attempts.'], 429));
        $present = $this->check('GET', self::THING, new JsonResponse(['message' => 'Too Many Attempts.'], 429, ['Retry-After' => '30']));

        $this->assertStringContainsString('429: required header Retry-After is missing', $missing?->failures[0] ?? '');
        $this->assertSame([], $present?->failures);
    }

    public function test_a_documented_header_must_match_its_schema(): void
    {
        $retryAfter = $this->check('GET', self::THING, new JsonResponse(['message' => 'Too Many Attempts.'], 429, ['Retry-After' => 'soon']));
        $cached = $this->check('GET', 'api/v1/cached', new JsonResponse(['ok' => true]));
        $noStore = $this->check('GET', 'api/v1/cached', new JsonResponse(['ok' => true], 200, ['Cache-Control' => 'no-store']));

        $this->assertStringContainsString('429: header Retry-After: expected integer, got string', $retryAfter?->failures[0] ?? '');
        $this->assertStringContainsString('200: header Cache-Control: ', $cached?->failures[0] ?? '');
        $this->assertSame([], $noStore?->failures, 'Symfony sends "no-store, private", which contains no-store');
    }

    public function test_bodies_and_content_types_the_contract_does_not_describe_fail(): void
    {
        $html = $this->check('GET', self::THING, new Response('<p>hi</p>', 200, ['Content-Type' => 'text/html; charset=UTF-8']));
        $unexpectedBody = $this->check('DELETE', self::THING, new JsonResponse(['deleted' => true], 204));
        $empty = $this->check('GET', self::THING, new Response('', 200, ['Content-Type' => 'application/json']));

        $this->assertStringContainsString('200: content type text/html not documented (documented: application/json)', $html?->failures[0] ?? '');
        $this->assertStringContainsString('204: returned a body (application/json) but the contract documents none', $unexpectedBody?->failures[0] ?? '');
        $this->assertStringContainsString('200: returned an empty body but the contract documents application/json', $empty?->failures[0] ?? '');
        $this->assertSame([], $this->check('DELETE', self::THING, new Response('', 204))?->failures);
    }

    public function test_references_to_other_schemas_in_contracts_are_followed(): void
    {
        $fixture = json_decode((string) file_get_contents(dirname(ContractFiles::directory()).'/location/v1/fix.fixture.json'), true);
        $route = 'api/integration/v1/organizations/{organization}/fixes/{event}';

        $this->assertSame([], $this->check('GET', $route, new JsonResponse(['data' => $fixture]))?->failures);
        $this->assertStringContainsString(
            '200: /data/schema_version: expected "location-fix.v1", got "location-fix.v0"',
            $this->check('GET', $route, new JsonResponse(['data' => ['schema_version' => 'location-fix.v0'] + $fixture]))?->failures[0] ?? '',
        );
    }

    public function test_routes_outside_the_contract_are_not_checked_and_missing_operations_fail(): void
    {
        $this->assertNull($this->check('GET', 'api/internal/devices/status', new JsonResponse([])));
        $this->assertNull($this->check('GET', 'up', new Response('ok')));
        $this->assertNull($this->check('HEAD', self::THING, new Response('')));

        $this->assertStringContainsString(
            'contract G4: GET /v1/unknown 200: the operation is not in the contract',
            $this->check('GET', 'api/v1/unknown', new JsonResponse([]))?->failures[0] ?? '',
        );
    }

    public function test_the_suite_fails_a_test_whose_response_breaks_the_committed_contract(): void
    {
        // GET /v1/me documents 200 and 401; a 418 is drift and must fail the calling test.
        Router::get('api/v1/me', static fn (): JsonResponse => new JsonResponse(['message' => 'teapot'], 418));

        try {
            $this->getJson('/api/v1/me');
        } catch (AssertionFailedError $failure) {
            $this->assertStringStartsWith('contract G4: GET /v1/me 418: status not documented', $failure->getMessage());

            return;
        }

        $this->fail('The undocumented 418 from GET /v1/me was not reported.');
    }

    #[WithoutContractCheck('The response checker\'s own test of the opt-out: it returns an undocumented status on purpose.')]
    public function test_the_opt_out_attribute_turns_the_checks_off_for_one_test(): void
    {
        Router::get('api/v1/me', static fn (): JsonResponse => new JsonResponse(['message' => 'teapot'], 418));

        $this->getJson('/api/v1/me')->assertStatus(418);
    }

    private function check(string $method, string $uri, SymfonyResponse $response): ?CheckedResponse
    {
        $route = new Route([$method], $uri, static fn (): null => null);
        $request = Request::create('/'.str_replace(['{organization}', '{thing}', '{event}'], [self::UUID, self::UUID, self::UUID], $uri), $method);
        $request->setRouteResolver(static fn (): Route => $route);

        return (new ResponseChecker($this->document()))->check($request, $response);
    }

    private function document(): ContractDocument
    {
        $errorMessage = ['application/json' => ['schema' => ['$ref' => '#/components/schemas/ErrorMessage']]];

        return ContractDocument::fromJson((string) json_encode([
            'openapi' => '3.1.0',
            'info' => ['title' => 'Fixture', 'version' => '1.0.0'],
            'paths' => [
                '/v1/organizations/{organization}/things/{thing}' => [
                    'get' => ['responses' => [
                        '200' => ['description' => 'A thing.', 'content' => ['application/json' => ['schema' => [
                            'type' => 'object',
                            'required' => ['data'],
                            'additionalProperties' => false,
                            'properties' => ['data' => ['$ref' => '#/components/schemas/Thing']],
                        ]]]],
                        '404' => ['$ref' => '#/components/responses/NotFound'],
                        '429' => ['$ref' => '#/components/responses/TooManyRequests'],
                    ]],
                    'delete' => ['responses' => ['204' => ['description' => 'Deleted.']]],
                ],
                '/v1/ranges' => ['get' => ['responses' => [
                    '5XX' => ['description' => 'Any server error.', 'content' => $errorMessage],
                    'default' => ['description' => 'Anything else.', 'content' => $errorMessage],
                ]]],
                '/v1/cached' => ['get' => ['responses' => [
                    '200' => [
                        'description' => 'Never cached.',
                        'headers' => ['Cache-Control' => ['required' => true, 'schema' => ['type' => 'string', 'pattern' => '(^|[ ,])no-store([ ,]|$)']]],
                        'content' => ['application/json' => ['schema' => ['type' => 'object', 'properties' => ['ok' => ['type' => 'boolean']]]]],
                    ],
                ]]],
                '/v1/pending' => ['get' => [
                    'responses' => [
                        '200' => ['description' => '', 'content' => ['application/json' => ['schema' => ['description' => 'Not described yet.']]]],
                        '204' => ['description' => ''],
                        '404' => ['$ref' => '#/components/responses/NotFound'],
                    ],
                    'x-schema-status' => 'pending',
                ]],
                '/integration/v1/organizations/{organization}/fixes/{event}' => ['get' => ['responses' => [
                    '200' => ['description' => 'A fix.', 'content' => ['application/json' => ['schema' => [
                        'type' => 'object',
                        'required' => ['data'],
                        'properties' => ['data' => ['$ref' => '../location/v1/fix.schema.json']],
                    ]]]],
                ]]],
            ],
            'components' => [
                'schemas' => [
                    'ErrorMessage' => ['type' => 'object', 'required' => ['message'], 'properties' => ['message' => ['type' => 'string']]],
                    'Thing' => [
                        'type' => 'object',
                        'required' => ['uuid', 'created_by', 'name'],
                        'properties' => [
                            'uuid' => ['type' => 'string', 'format' => 'uuid'],
                            'created_by' => ['type' => 'integer'],
                            'name' => ['type' => ['string', 'null'], 'default' => null],
                        ],
                    ],
                ],
                'headers' => ['RetryAfter' => ['required' => true, 'schema' => ['type' => 'integer']]],
                'responses' => [
                    'NotFound' => ['description' => 'Not found.', 'content' => $errorMessage],
                    'TooManyRequests' => [
                        'description' => 'Slow down.',
                        'headers' => ['Retry-After' => ['$ref' => '#/components/headers/RetryAfter']],
                        'content' => $errorMessage,
                    ],
                ],
            ],
        ], JSON_UNESCAPED_SLASHES), dirname(ContractFiles::directory()), 'fixture openapi.json');
    }
}
