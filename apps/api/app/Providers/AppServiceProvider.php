<?php

namespace App\Providers;

use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Authorization\Services\PlatformAuthorization;
use App\Domain\DeviceManagement\Models\Device;
use App\Domain\DeviceManagement\Models\DeviceDefinitionAssignment;
use App\Domain\DeviceManagement\Policies\DeviceDefinitionAssignmentPolicy;
use App\Domain\DeviceManagement\Policies\DevicePolicy;
use App\Domain\DeviceProfile\Models\DeviceProfile;
use App\Domain\DeviceProfile\Models\DeviceProfileVersion;
use App\Domain\DeviceProfile\Models\TransportBinding;
use App\Domain\DeviceProfile\Models\TransportBindingVersion;
use App\Domain\DeviceProfile\Policies\DeviceProfilePolicy;
use App\Domain\DeviceProfile\Policies\DeviceProfileVersionPolicy;
use App\Domain\DeviceProfile\Policies\TransportBindingPolicy;
use App\Domain\DeviceProfile\Policies\TransportBindingVersionPolicy;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\Gate;
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
        Gate::before(static fn (?User $user): ?bool => $user?->is_super_admin ? true : null);
        Gate::policy(DeviceProfile::class, DeviceProfilePolicy::class);
        Gate::policy(DeviceProfileVersion::class, DeviceProfileVersionPolicy::class);
        Gate::policy(TransportBinding::class, TransportBindingPolicy::class);
        Gate::policy(TransportBindingVersion::class, TransportBindingVersionPolicy::class);
        Gate::policy(Device::class, DevicePolicy::class);
        Gate::policy(DeviceDefinitionAssignment::class, DeviceDefinitionAssignmentPolicy::class);

        foreach (PlatformAdministrationPermission::cases() as $permission) {
            Gate::define($permission->value, static function (User $user) use ($permission): bool {
                return app(PlatformAuthorization::class)->allows($user, $permission);
            });
        }
    }
}
