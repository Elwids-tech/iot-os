<?php

use App\Domain\DeviceProfiles\Exceptions\ProfileDraftConflictException;
use App\Domain\DeviceProfiles\Exceptions\ProfileValidationException;
use App\Domain\Integrations\Console\WebhookWorker;
use App\Http\Middleware\OperationRequestLog;
use App\Http\Middleware\TrustDeploymentProxies;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Middleware\TrustProxies;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withCommands([WebhookWorker::class, \App\Domain\Automation\Console\AutomationWorker::class, \App\Domain\Help\Console\ValidateHelp::class])
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->statefulApi();
        $middleware->replace(TrustProxies::class, TrustDeploymentProxies::class);
        $middleware->append(OperationRequestLog::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->render(function (ProfileValidationException $exception, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            return response()->json([
                'message' => $exception->getMessage(),
                'diagnostics' => array_map(static fn ($diagnostic): array => $diagnostic->toArray(), $exception->diagnostics),
            ], 422);
        });
        $exceptions->render(function (ProfileDraftConflictException $exception, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            return response()->json(['message' => $exception->getMessage(), 'code' => 'profile.draft_conflict'], 409);
        });
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
