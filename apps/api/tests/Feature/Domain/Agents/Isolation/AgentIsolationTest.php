<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Agents\Isolation;

use App\Domain\Agents\Mcp\PlatformServer;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\Site;
use App\Domain\Integrations\Models\IntegrationApplication;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Spatie\Permission\PermissionRegistrar;
use Tests\Support\Agents\AgentFixtures;
use Tests\TestCase;

/**
 * Every agent tool stays inside the connection's organization and the person's
 * permissions, and never returns a secret (spec 004 SC-004, SC-005).
 */
final class AgentIsolationTest extends TestCase
{
    use AgentFixtures, RefreshDatabase;

    private Organization $a;

    private Organization $b;

    private Device $foreign;

    private Site $foreignSite;

    /** @var list<string> */
    private array $secrets = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->usePassportTestKeys();
        config(['agents.enabled' => true, 'app.frontend_url' => 'https://app.example.test']);
        $this->withoutMiddleware(ValidateCsrfToken::class);
        $this->a = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->b = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $this->a->forceFill(['agent_access_enabled' => true])->save();
        $this->foreignSite = Site::create(['organization_id' => $this->b->id, 'name' => 'iso-b-site', 'timezone' => 'UTC']);
        $this->foreign = Device::create(['organization_id' => $this->b->id, 'code' => 'iso-b-device', 'name' => 'iso-b-device', 'site_id' => $this->foreignSite->id, 'tags' => ['iso-b-tag']]);
        Device::create(['organization_id' => $this->a->id, 'code' => 'iso-a-device', 'name' => 'iso-a-device']);
        $this->seedSecrets();
    }

    /** Arguments that point each tool at organization B's records, where it takes any. */
    private function foreignArguments(string $tool): array
    {
        return match ($tool) {
            'find_devices' => ['site_uuid' => $this->foreignSite->uuid, 'tag' => 'iso-b-tag', 'search' => 'iso-b'],
            default => [],
        };
    }

    public function test_every_tool_stays_inside_the_connection_organization(): void
    {
        $agent = $this->connectAgent(User::where('email', 'shared.operator@example.test')->firstOrFail(), $this->a);

        foreach ($this->toolNames() as $tool) {
            $result = $this->callTool($agent['access_token'], $tool, $this->foreignArguments($tool));
            $json = json_encode($result, JSON_UNESCAPED_SLASHES);
            $this->assertStringNotContainsString($this->foreign->uuid, $json, "{$tool} returned organization B's device");
            $this->assertStringNotContainsString('iso-b-', $json, "{$tool} returned organization B's data");
            $this->assertNoSecrets($tool, $json);
        }
    }

    public function test_every_tool_refuses_a_member_without_its_permission(): void
    {
        $member = User::where('email', 'acme.member@example.test')->firstOrFail();
        $agent = $this->connectAgent($member, $this->a);
        DB::table(config('permission.table_names.model_has_roles'))->where('model_id', $member->id)->delete();
        app(PermissionRegistrar::class)->forgetCachedPermissions();

        foreach ($this->toolNames() as $tool) {
            $result = $this->callTool($agent['access_token'], $tool);
            $this->assertTrue($result['error'], "{$tool} answered without permission");
            $this->assertContains($result['body']['error']['code'], ['permission', 'not_found'], $tool);
        }
    }

    /** @return list<string> */
    private function toolNames(): array
    {
        return array_map(static fn (string $class): string => app($class)->name(), PlatformServer::TOOLS);
    }

    private function seedSecrets(): void
    {
        $application = IntegrationApplication::create(['organization_id' => $this->a->id, 'name' => 'Consumer', 'abilities' => ['devices:read'], 'device_uuids' => []]);
        $plain = 'iso-secret-'.Str::random(32);
        $application->tokens()->create(['name' => 'test', 'token' => hash('sha256', $plain), 'abilities' => ['devices:read'], 'expires_at' => now()->addDay()]);
        $this->secrets = [$plain, hash('sha256', $plain), (string) config('passport.private_key')];
    }

    private function assertNoSecrets(string $tool, string $json): void
    {
        foreach ($this->secrets as $secret) {
            $this->assertStringNotContainsString(substr($secret, 0, 40), $json, "{$tool} returned a secret");
        }
        $this->assertDoesNotMatchRegularExpression('/-----BEGIN [A-Z ]*PRIVATE KEY-----/', $json, "{$tool} returned a private key");
    }
}
