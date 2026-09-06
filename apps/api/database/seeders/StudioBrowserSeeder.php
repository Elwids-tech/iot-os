<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Domain\Administration\Models\OrganizationInvitation;
use App\Domain\Authorization\Models\Role;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

final class StudioBrowserSeeder extends Seeder
{
    public function run(): void
    {
        if (config('database.default') !== 'sqlite' || ! str_contains((string) config('database.connections.sqlite.database'), 'iot-studio-e2e-')) {
            throw new \LogicException('Browser fixtures may only be seeded into the disposable Studio test database.');
        }
        $organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $inviter = User::where('email', 'shared.operator@example.test')->firstOrFail();
        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        foreach ([['a', $organization, 'studio.new@example.test', 'organization-admin'], ['b', $northstar, 'acme.member@example.test', 'member']] as [$token, $tenant, $email, $roleName]) {
            $role = Role::where('organization_id', $tenant->id)->where('name', $roleName)->firstOrFail();
            OrganizationInvitation::create(['uuid' => (string) Str::uuid(), 'organization_id' => $tenant->id, 'email' => $email, 'role_ids' => [$role->id], 'token_hash' => hash('sha256', str_repeat($token, 64)), 'invited_by_user_id' => $inviter->id, 'expires_at' => now()->addDay()]);
        }
        $profile = DeviceProfile::create(['organization_id' => $organization->id, 'code' => 'large-test-profile', 'name' => 'Large device profile', 'category' => 'Scale test']);
        for ($index = 1; $index <= 500; $index++) {
            $profile->parameters()->create(['key' => 'sensor.'.$index, 'label' => 'Sensor '.str_pad((string) $index, 4, '0', STR_PAD_LEFT), 'kind' => 'measurement', 'data_type' => 'number', 'reports_state' => true, 'sort_order' => $index]);
        }
    }
}
