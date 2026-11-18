<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Domain\Authorization\Models\PlatformRole;
use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Spatie\Permission\Models\Permission;

/** Platform staff and passkeys for the lock-out reset tests (spec 034, US4). */
trait TwoStepResetFixtures
{
    /**
     * A person on a platform role holding exactly these permissions.
     *
     * @param  list<PlatformAdministrationPermission>  $permissions
     */
    protected function platformStaff(array $permissions, array $attributes = []): User
    {
        $role = PlatformRole::query()->create(['key' => 'role-'.Str::random(8), 'display_name' => 'Staff', 'is_system' => false]);
        $role->permissions()->sync(array_map(
            fn (PlatformAdministrationPermission $permission): int => (int) Permission::findOrCreate($permission->value, 'web')->getKey(),
            $permissions,
        ));
        $user = User::factory()->create($attributes);
        $user->platformRoles()->attach($role);

        return $user;
    }

    /**
     * Gives the person passkeys. Until spec 034 pull request 4 adds the `passkeys` table, a
     * table with the same columns stands in for it.
     */
    protected function givePasskeys(User $user, int $count): void
    {
        if (! Schema::hasTable('passkeys')) {
            Schema::create('passkeys', function (Blueprint $table): void {
                $table->id();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->string('name');
                $table->string('credential_id')->unique();
                $table->json('credential');
                $table->timestamp('last_used_at')->nullable();
                $table->timestamps();
            });
        }
        for ($i = 0; $i < $count; $i++) {
            DB::table('passkeys')->insert([
                'user_id' => $user->getKey(),
                'name' => 'Passkey '.$i,
                'credential_id' => Str::random(32),
                'credential' => '{}',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }
}
