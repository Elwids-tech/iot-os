<?php

declare(strict_types=1);

namespace Tests\Support\Contract;

use App\Support\Contract\ContractRoutes;
use Illuminate\Http\Request;
use Illuminate\Routing\Route;
use Symfony\Component\HttpFoundation\Response;

/**
 * Gate G4 for one response (specs/001-openapi-contract/contracts/ci-gate.md): the status
 * is documented; for a fully described operation the documented required headers are
 * present, documented headers match their schema (`Retry-After` an integer,
 * `Cache-Control` containing `no-store`), and the body matches the documented content
 * type and JSON schema. An operation on the pending-schema list
 * (`x-schema-status: pending`) gets the status check only.
 *
 * The operation comes from the route Laravel matched, whose method and URI template are
 * the contract's method and path, so there is no path matching to get wrong.
 */
final class ResponseChecker
{
    private const FIX_STATUS = 'add the status to the operation in contracts/openapi/supplements/<domain>.yaml and run php artisan contract:export; the platform is right, the contract follows it (record it in specs/001-openapi-contract/drift-log.md)';

    private const FIX_BODY = 'correct the response in contracts/openapi/supplements/<domain>.yaml and run php artisan contract:export; the platform is right, the contract follows it (record it in specs/001-openapi-contract/drift-log.md)';

    public function __construct(private readonly ContractDocument $document) {}

    /**
     * @return CheckedResponse|null null when the request matched no in-scope route
     */
    public function check(Request $request, Response $response): ?CheckedResponse
    {
        $route = $request->route();
        $method = strtolower($request->getMethod());
        if (! $route instanceof Route || ! ContractRoutes::inScope($route) || ! in_array($method, ContractRoutes::METHODS, true)) {
            return null;
        }

        $key = ContractRoutes::operationKey($method, $route);
        $status = $response->getStatusCode();
        if ($this->document->operation($key) === null) {
            return new CheckedResponse($key, $status, [
                $this->failure($key, $status, 'the operation is not in the contract', 'run php artisan contract:export and commit contracts/openapi/openapi.json'),
            ]);
        }

        $documented = $this->document->response($key, $status);
        if ($documented === null) {
            $statuses = implode(', ', $this->document->statuses($key));

            return new CheckedResponse($key, $status, [
                $this->failure($key, $status, "status not documented (documented: {$statuses})", self::FIX_STATUS),
            ]);
        }
        if ($this->document->isPending($key)) {
            return new CheckedResponse($key, $status, []);
        }

        $failures = [];
        foreach ($this->document->headers($documented['response'], $documented['pointer']) as $header) {
            $value = $response->headers->get($header['name']);
            if ($value === null) {
                if ($header['required']) {
                    $failures[] = $this->failure($key, $status, "required header {$header['name']} is missing", self::FIX_BODY);
                }

                continue;
            }
            $problem = $header['schema'] === null ? null : $this->document->validateHeader($value, $header['schema']);
            if ($problem !== null) {
                $failures[] = $this->failure($key, $status, "header {$header['name']}: {$problem}", self::FIX_BODY);
            }
        }
        $body = $this->checkBody($documented['response'], $documented['pointer'], $response);
        if ($body !== null) {
            $failures[] = $this->failure($key, $status, $body, self::FIX_BODY);
        }

        return new CheckedResponse($key, $status, $failures);
    }

    /**
     * @param  array<string, mixed>  $documented
     */
    private function checkBody(array $documented, string $pointer, Response $response): ?string
    {
        $content = $response->getContent();
        if ($content === false) {
            // Streamed and file responses cannot be read here; their content type still counts.
            $content = null;
        }
        $mediaTypes = is_array($documented['content'] ?? null) ? array_map('strval', array_keys($documented['content'])) : [];
        $actualType = strtolower(trim(explode(';', (string) $response->headers->get('Content-Type', ''))[0]));

        if ($mediaTypes === []) {
            return $content === null || $content === '' ? null : "returned a body ({$actualType}) but the contract documents none";
        }
        if ($content === '') {
            return 'returned an empty body but the contract documents '.implode(', ', $mediaTypes);
        }

        $mediaType = $this->matchMediaType($actualType, $mediaTypes);
        if ($mediaType === null) {
            return "content type {$actualType} not documented (documented: ".implode(', ', $mediaTypes).')';
        }
        if ($content === null || ! self::isJson($mediaType === '*/*' ? $actualType : $mediaType)) {
            return null;
        }

        $data = json_decode($content, false);
        if (json_last_error() !== JSON_ERROR_NONE) {
            return 'the body is not valid JSON: '.json_last_error_msg();
        }
        if (! isset($documented['content'][$mediaType]['schema'])) {
            return null;
        }

        return $this->document->validate($data, $pointer.'/content/'.rawurlencode(str_replace(['~', '/'], ['~0', '~1'], $mediaType)).'/schema');
    }

    /**
     * @param  list<string>  $documented
     */
    private function matchMediaType(string $actual, array $documented): ?string
    {
        $candidates = [$actual, explode('/', $actual)[0].'/*', '*/*'];
        foreach ($candidates as $candidate) {
            foreach ($documented as $mediaType) {
                if (strtolower(trim(explode(';', $mediaType)[0])) === $candidate) {
                    return $mediaType;
                }
            }
        }

        return null;
    }

    private static function isJson(string $mediaType): bool
    {
        $essence = strtolower(trim(explode(';', $mediaType)[0]));

        return $essence === 'application/json' || str_ends_with($essence, '+json');
    }

    /**
     * The G4 line: `contract G4: <METHOD /path> <status>: <difference>`, then the fix.
     */
    private function failure(string $key, int $status, string $difference, string $fix): string
    {
        return "contract G4: {$key} {$status}: {$difference}\n  fix: {$fix}";
    }
}
