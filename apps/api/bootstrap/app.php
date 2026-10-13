<?php

use App\Domain\Agents\Console\ExportToolCatalogue;
use App\Domain\Agents\Console\PruneAgents;
use App\Domain\Automation\Console\AutomationWorker;
use App\Domain\DeviceProfiles\Exceptions\ProfileDraftConflictException;
use App\Domain\DeviceProfiles\Exceptions\ProfileValidationException;
use App\Domain\Help\Console\ValidateHelp;
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
    ->withCommands([WebhookWorker::class, AutomationWorker::class, ValidateHelp::class, PruneAgents::class, ExportToolCatalogue::class])
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->statefulApi();
        // A signed-out person starting an agent connection signs in on the portal, which
        // then returns to the authorize URL. Other routes keep their behaviour.
        $middleware->redirectGuestsTo(fn (Request $request): ?string => $request->routeIs('passport.authorizations.authorize')
            ? rtrim((string) config('app.frontend_url'), '/').'/connect?'.http_build_query(['return' => $request->fullUrl()])
            : null);
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
