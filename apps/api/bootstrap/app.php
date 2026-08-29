<?php

use App\Domain\DeviceProfile\Exceptions\DefinitionCompilerTransportException;
use App\Domain\Shared\Concurrency\PreconditionRequired;
use App\Domain\Shared\Concurrency\StaleEntityTag;
use App\Domain\Shared\Exceptions\DomainInvariantViolation;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

$problemResponse = static function (
    Request $request,
    int $status,
    string $title,
    string $detail,
    array $headers = [],
): JsonResponse {
    $traceId = $request->header('X-Request-ID');

    if (! is_string($traceId) || trim($traceId) === '') {
        $traceId = (string) Str::uuid();
    }

    return response()->json([
        'type' => 'about:blank',
        'title' => $title,
        'status' => $status,
        'detail' => $detail,
        'instance' => $request->getRequestUri(),
        'trace_id' => $traceId,
    ], $status, [
        'Content-Type' => 'application/problem+json',
        ...$headers,
    ]);
};

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->statefulApi();
    })
    ->withExceptions(function (Exceptions $exceptions) use ($problemResponse): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );

        $exceptions->render(
            fn (PreconditionRequired $exception, Request $request): JsonResponse => $problemResponse(
                $request,
                428,
                'Precondition Required',
                $exception->getMessage(),
            ),
        );

        $exceptions->render(
            fn (StaleEntityTag $exception, Request $request): JsonResponse => $problemResponse(
                $request,
                412,
                'Precondition Failed',
                $exception->getMessage(),
                ['ETag' => $exception->currentEntityTag],
            ),
        );

        $exceptions->render(
            fn (DomainInvariantViolation $exception, Request $request): JsonResponse => $problemResponse(
                $request,
                409,
                'Conflict',
                $exception->getMessage(),
            ),
        );

        $exceptions->render(
            fn (DefinitionCompilerTransportException $exception, Request $request): JsonResponse => $problemResponse(
                $request,
                503,
                'Service Unavailable',
                $exception->getMessage(),
            ),
        );
    })->create();
