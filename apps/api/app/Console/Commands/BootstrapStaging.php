<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Domain\Authorization\Enums\OrganizationRoleName;
use App\Domain\Authorization\Models\Role;
use App\Domain\Devices\Services\RetentionService;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Spatie\Permission\PermissionRegistrar;

final class BootstrapStaging extends Command
{
    protected $signature = 'deployment:staging {--output= : New private credential file}';

    protected $description = 'Create additive staging accounts without replacing tester changes';

    public function handle(): int
    {
        if (! app()->environment('staging') || ! config('deployment.demo_enabled')) {
            $this->error('Requires staging and IOT_STAGING_DEMO_ENABLED=true.');

            return self::FAILURE;
        }
        $path = $this->option('output');
        if (! is_string($path) || ! str_starts_with($path, '/') || ! is_dir(dirname($path))) {
            $this->error('Provide --output in an existing private directory.');

            return self::FAILURE;
        }
        $mask = umask(0077);
        $file = @fopen($path, 'x');
        umask($mask);
        if (! $file) {
            $this->error('Output must be a new private file.');

            return self::FAILURE;
        }
        $registrar = app(PermissionRegistrar::class);
        $previousTeam = $registrar->getPermissionsTeamId();
        try {
            DB::transaction(function () use ($file, $registrar): void {
                $this->call('db:seed', ['--class' => 'PermissionSeeder', '--force' => true]);
                $credentials = [];
                $createUser = static function (string $email, string $name, bool $super = false) use (&$credentials): User {
                    $user = User::where('email', $email)->first();
                    if ($user) {
                        return $user;
                    }
                    $password = Str::random(32);
                    $user = User::forceCreate(['name' => $name, 'email' => $email, 'password' => $password, 'is_super_admin' => $super, 'email_verified_at' => now()]);
                    $credentials[] = ['email' => $email, 'password' => $password];

                    return $user;
                };
                $admin = $createUser('staging-admin@example.test', 'Staging administrator', true);
                foreach (['acme-manufacturing' => 'Acme Manufacturing', 'northstar-utilities' => 'Northstar Utilities'] as $slug => $name) {
                    // A repeat run never recreates deleted memberships, grants, or organizations.
                    if (Organization::withTrashed()->where('slug', $slug)->exists()) {
                        continue;
                    }
                    $org = Organization::create(['slug' => $slug, 'name' => $name, 'uuid' => (string) Str::uuid()]);
                    $registrar->setPermissionsTeamId($org->id);
                    foreach (['operator' => OrganizationRoleName::ORGANIZATION_ADMIN, 'moderator' => OrganizationRoleName::MODERATOR, 'member' => OrganizationRoleName::MEMBER] as $label => $roleName) {
                        $user = $createUser($slug.'.'.$label.'@example.test', $name.' '.$label);
                        $user->organizations()->syncWithoutDetaching([$org->id]);
                        $role = Role::firstOrCreate(['organization_id' => $org->id, 'name' => $roleName->value, 'guard_name' => 'web'], ['display_name' => $roleName->displayName(), 'is_default' => true]);
                        $role->syncPermissions($roleName->permissions());
                        $user->assignRole($role);
                    }
                    app(RetentionService::class)->update($org, 7, 0, true, $admin->id);
                }
                $data = json_encode($credentials, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR);
                if (fwrite($file, $data) !== strlen($data) || ! fflush($file)) {
                    throw new \RuntimeException('Unable to persist generated credentials.');
                }
            });
        } catch (\Throwable $e) {
            fclose($file);
            unlink($path);
            throw $e;
        } finally {
            $registrar->setPermissionsTeamId($previousTeam);
            $registrar->forgetCachedPermissions();
        }
        fclose($file);
        $this->info('Staging accounts prepared. Only newly created passwords are in the private output file.');

        return self::SUCCESS;
    }
}
