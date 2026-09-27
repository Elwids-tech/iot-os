<?php

namespace App\Providers;

use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Authorization\Services\PlatformAuthorization;
use App\Domain\Shared\Models\User;
use App\Support\Operations;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        Queue::looping(static fn () => Operations::heartbeat());

        Gate::before(static fn (?User $user): ?bool => $user?->is_super_admin ? true : null);

        foreach (PlatformAdministrationPermission::cases() as $permission) {
            Gate::define($permission->value, static function (User $user) use ($permission): bool {
                return app(PlatformAuthorization::class)->allows($user, $permission);
            });
        }
    }
}
