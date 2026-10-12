<?php

declare(strict_types=1);

namespace App\Support\Contract;

use App\Support\Contract\Console\CheckContract;
use App\Support\Contract\Console\ExportContract;
use Dedoc\Scramble\Scramble;
use Illuminate\Routing\Route;
use Illuminate\Support\ServiceProvider;

/**
 * Wires the public API contract generator (dedoc/scramble, a dev dependency). Registered
 * from bootstrap/providers.php only where Scramble is installed, and inert without it.
 * It adds no route: Scramble's /docs/api routes stay off in every environment.
 */
final class ContractServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        if (! class_exists(Scramble::class)) {
            return;
        }

        Scramble::ignoreDefaultRoutes();

        $this->app->singleton(PathConstraintTransformer::class);
        $this->app->singleton(SecurityTransformer::class);
        $this->app->singleton(SupplementTransformer::class);
        $this->app->singleton(ContractExporter::class);
    }

    public function boot(): void
    {
        if (! class_exists(Scramble::class)) {
            return;
        }

        Scramble::configure()
            ->routes(static fn (Route $route): bool => ContractRoutes::inScope($route))
            ->resolveOperationMethodsUsing(static fn (Route $route): array => ContractRoutes::methods($route));

        if ($this->app->runningInConsole()) {
            $this->commands([ExportContract::class, CheckContract::class]);
        }
    }
}
