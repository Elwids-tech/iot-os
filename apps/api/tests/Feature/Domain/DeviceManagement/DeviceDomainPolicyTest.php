<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\DeviceManagement;

use App\Domain\DeviceManagement\Models\Device;
use App\Domain\DeviceProfile\Models\DeviceProfile;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Gate;
use Tests\TestCase;

final class DeviceDomainPolicyTest extends TestCase
{
    use RefreshDatabase;

    public function test_device_domain_policies_use_membership_and_the_active_organization_role(): void
    {
        $this->seed(DatabaseSeeder::class);
        $acme = Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail();
        $profile = DeviceProfile::query()->create([
            'organization_id' => $acme->id,
            'key' => 'environment_sensor',
            'name' => 'Environment Sensor',
        ]);
        $device = Device::query()->create([
            'organization_id' => $acme->id,
            'external_id' => 'sensor-001',
            'name' => 'Sensor 1',
        ]);

        $organizationAdmin = User::query()->where('email', 'shared.operator@example.test')->firstOrFail();
        $member = User::query()->where('email', 'acme.member@example.test')->firstOrFail();
        $otherTenantMember = User::query()->where('email', 'northstar.member@example.test')->firstOrFail();
        $platformAdministrator = User::query()->where('email', 'platform-admin@example.test')->firstOrFail();
        $superAdmin = User::query()->where('email', 'super-admin@example.test')->firstOrFail();

        $this->assertTrue(Gate::forUser($organizationAdmin)->allows('update', $profile));
        $this->assertTrue(Gate::forUser($organizationAdmin)->allows('register', $device));
        $this->assertTrue(Gate::forUser($member)->allows('view', $profile));
        $this->assertFalse(Gate::forUser($member)->allows('update', $profile));
        $this->assertFalse(Gate::forUser($otherTenantMember)->allows('view', $profile));
        $this->assertFalse(Gate::forUser($platformAdministrator)->allows('view', $profile));
        $this->assertTrue(Gate::forUser($superAdmin)->allows('update', $profile));
    }
}
