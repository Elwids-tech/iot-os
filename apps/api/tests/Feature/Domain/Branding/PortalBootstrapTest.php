<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Branding;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Branding\Models\Brand;
use App\Domain\Branding\Services\BrandImages;
use App\Domain\Branding\Services\Brands;
use App\Domain\Branding\Services\PortalAddresses;
use App\Domain\Branding\Services\PortalBootstrap;
use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * What the portal learns about its host before it starts, and what the proxy is told
 * before it asks for a certificate (spec 036, contracts/portal-bootstrap.md, FR-014).
 */
final class PortalBootstrapTest extends TestCase
{
    use BrandImageFixtures, PortalAddressFixtures, RefreshDatabase;

    private BillingAccount $account;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake(BrandImages::DISK);
        $this->turnAddressesOn();
        config(['branding.portal.map_style_url' => 'https://maps.example.com/style.json', 'branding.portal.environment' => 'production', 'branding.platform_name' => 'IoT OS']);
        $this->account = $this->brandedAccount('acme', 'Acme Monitor');
    }

    public function test_a_name_gets_its_brand_the_platforms_api_and_no_admin_address(): void
    {
        Brand::query()->where('billing_account_id', $this->account->id)->update(['support_url' => 'https://support.example.org/help']);
        $brands = app(Brands::class);
        $brands->setImage($this->account, 'logo', $this->image(600, 200), null);
        $brand = $brands->setImage($this->account, 'icon', $this->image(512, 512), null);

        $response = $this->bootstrap('acme.example.com')
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->assertStringStartsWith('application/javascript', (string) $response->headers->get('Content-Type'));

        $config = $this->config($response);
        $this->assertSame('https://api.example.com', $config['VITE_API_URL']);
        $this->assertSame('https://acme.example.com', $config['VITE_PORTAL_URL']);
        $this->assertSame('', $config['VITE_ADMIN_URL']);
        $this->assertSame('https://maps.example.com/style.json', $config['VITE_MAP_STYLE_URL']);
        $this->assertSame('production', $config['environment']);
        $this->assertSame(['kind' => 'name', 'host' => 'acme.example.com', 'state' => 'active'], $config['address']);
        $this->assertFalse($config['sign_up']);
        $this->assertSame([
            'product_name' => 'Acme Monitor',
            'short_name' => 'Acme Monitor',
            'support_url' => 'https://support.example.org/help',
            'logo' => 'https://api.example.com/api/v1/brand-assets/'.$brand->logo->publicKey().'/logo',
            'logo_dark' => null,
            'icon' => 'https://api.example.com/api/v1/brand-assets/'.$brand->icon->publicKey().'/192',
            'touch_icon' => 'https://api.example.com/api/v1/brand-assets/'.$brand->icon->publicKey().'/180',
            'powered_by' => 'IoT OS',
        ], $config['brand']);
    }

    public function test_powered_by_is_gone_only_with_its_allowance_and_a_long_name_is_cut_for_the_short_one(): void
    {
        Brand::query()->where('billing_account_id', $this->account->id)->update(['product_name' => 'Acme Remote Monitoring']);
        $this->assertSame('IoT OS', $this->config($this->bootstrap('acme.example.com'))['brand']['powered_by']);

        $this->allow($this->account, AllowanceKind::HidePoweredBy);
        $brand = $this->config($this->bootstrap('acme.example.com'))['brand'];
        $this->assertNull($brand['powered_by']);
        $this->assertSame('Acme Remote', $brand['short_name']);
    }

    public function test_hosts_that_do_not_serve_get_no_brand_and_nothing_about_the_deployment(): void
    {
        $notInUse = ['VITE_API_URL' => '', 'VITE_PORTAL_URL' => '', 'VITE_ADMIN_URL' => '', 'VITE_MAP_STYLE_URL' => '', 'environment' => 'production', 'address' => ['state' => 'not_in_use'], 'sign_up' => false];
        $addresses = app(PortalAddresses::class);
        $staff = User::factory()->create(['is_super_admin' => true]);

        $this->assertSame($notInUse, $this->config($this->bootstrap('nobody.example.com')));
        $this->assertSame($notInUse, $this->config($this->bootstrap('portal.example.org')));

        $addresses->suspend($this->addressOf($this->account), $staff);
        $this->assertSame($notInUse, $this->config($this->bootstrap('acme.example.com')));
        $addresses->restore($this->addressOf($this->account), $staff);

        $this->allow($this->account, AllowanceKind::Branding, 0);
        $this->assertSame($notInUse, $this->config($this->bootstrap('acme.example.com')));
        $this->allow($this->account);

        $addresses->release($this->addressOf($this->account), $staff);
        $this->assertSame($notInUse, $this->config($this->bootstrap('acme.example.com')));

        config(['branding.addresses_enabled' => false]);
        $this->assertSame($notInUse, $this->config($this->bootstrap('acme.example.com')));
    }

    public function test_an_address_whose_brand_has_no_name_yet_serves_without_a_brand(): void
    {
        Brand::query()->where('billing_account_id', $this->account->id)->update(['product_name' => null]);
        $config = $this->config($this->bootstrap('acme.example.com'));
        $this->assertSame('active', $config['address']['state']);
        $this->assertNull($config['brand']);
    }

    public function test_a_renamed_name_sends_its_visitors_to_the_new_one(): void
    {
        app(PortalAddresses::class)->claimName($this->account, 'acme-monitor', null);

        $this->assertSame(['state' => 'moved', 'to' => 'https://acme-monitor.example.com'], $this->config($this->bootstrap('acme.example.com'))['address']);
        $this->assertSame('active', $this->config($this->bootstrap('acme-monitor.example.com'))['address']['state']);
    }

    public function test_a_product_name_cannot_close_the_script(): void
    {
        Brand::query()->where('billing_account_id', $this->account->id)->update(['product_name' => '</script><script>alert(1)</script>', 'short_name' => "a'\"&<b>"]);

        $body = (string) $this->bootstrap('acme.example.com')->getContent();
        $this->assertStringNotContainsString('</script>', $body);
        $this->assertStringNotContainsString('<', $body);
        $this->assertSame('</script><script>alert(1)</script>', $this->config($body)['brand']['product_name']);
        $this->assertSame("a'\"&<b>", $this->config($body)['brand']['short_name']);
    }

    public function test_the_same_origin_setting_of_development_gives_relative_api_and_image_addresses(): void
    {
        config(['branding.same_origin_names' => true]);
        $brand = app(Brands::class)->setImage($this->account, 'logo', $this->image(600, 200), null);

        $config = $this->config($this->bootstrap('acme.example.com'));
        $this->assertSame('', $config['VITE_API_URL']);
        $this->assertSame('/api/v1/brand-assets/'.$brand->logo->publicKey().'/logo', $config['brand']['logo']);
    }

    public function test_the_proxy_is_told_yes_only_for_an_address_that_serves(): void
    {
        $ask = fn (string $domain, ?string $token = null): TestResponse => $this->get('/api/internal/portal-addresses/ask?'.http_build_query(['token' => $token ?? str_repeat('t', 40), 'domain' => $domain]));

        $ask('acme.example.com')->assertOk();
        $ask('nobody.example.com')->assertNotFound();
        $ask('example.com')->assertNotFound();
        $ask('')->assertNotFound();
        $ask('acme.example.com', 'wrong')->assertUnauthorized();
        $this->get('/api/internal/portal-addresses/ask?domain=acme.example.com')->assertUnauthorized();

        // A renamed name still needs its certificate to redirect.
        app(PortalAddresses::class)->claimName($this->account, 'acme-monitor', null);
        $ask('acme.example.com')->assertOk();

        app(PortalAddresses::class)->suspend($this->addressOf($this->account), User::factory()->create(['is_super_admin' => true]));
        $ask('acme-monitor.example.com')->assertNotFound();
        $ask('acme.example.com')->assertNotFound();

        // A short or missing deployment token never matches.
        config(['branding.ask_token' => 'short']);
        $ask('acme.example.com', 'short')->assertUnauthorized();
        config(['branding.ask_token' => null]);
        $ask('acme.example.com', '')->assertUnauthorized();
    }

    public function test_an_address_gets_the_builds_manifest_under_its_brands_name(): void
    {
        Brand::query()->where('billing_account_id', $this->account->id)->update(['short_name' => 'Acme']);

        $response = $this->get('https://acme.example.com/api/v1/portal/manifest.webmanifest')->assertOk()
            ->assertHeader('Content-Type', 'application/manifest+json')
            ->assertHeader('Cache-Control', 'no-cache, private');
        $manifest = $response->json();

        $this->assertSame('Acme Monitor', $manifest['name']);
        $this->assertSame('Acme', $manifest['short_name']);
        // Every other member is the build's.
        $built = (array) config('branding.manifest');
        $this->assertSame(Arr::except($built, ['name', 'short_name']), Arr::except($manifest, ['name', 'short_name']));
        $this->assertSame(['pwa-64x64.png', 'pwa-192x192.png', 'pwa-512x512.png', 'maskable-icon-512x512.png'], array_column($manifest['icons'], 'src'));
        $this->assertStringNotContainsString('IoT OS', (string) $response->getContent());
    }

    public function test_the_manifest_kept_here_is_the_one_the_portal_builds(): void
    {
        $config = base_path('../portal/vite.config.ts');
        if (! is_file($config)) {
            $this->markTestSkipped('The portal is not beside the API here.');
        }
        $source = (string) file_get_contents($config);
        $built = (array) config('branding.manifest');
        foreach (Arr::except($built, ['icons', 'lang']) as $member => $value) {
            $this->assertStringContainsString($member.': "'.$value.'"', $source);
        }
        foreach ($built['icons'] as $icon) {
            $this->assertStringContainsString('src: "'.$icon['src'].'", sizes: "'.$icon['sizes'].'"', $source);
        }
    }

    public function test_a_host_that_is_not_in_use_has_no_manifest_and_no_icons(): void
    {
        $this->get('https://nobody.example.com/api/v1/portal/manifest.webmanifest')->assertNotFound();
        $this->get('https://nobody.example.com/api/v1/portal/icons/pwa-192x192.png')->assertNotFound();

        $this->allow($this->account, value: 0);
        $this->get('https://acme.example.com/api/v1/portal/manifest.webmanifest')->assertNotFound();
        $this->get('https://acme.example.com/api/v1/portal/icons/pwa-192x192.png')->assertNotFound();
    }

    public function test_the_five_icon_paths_answer_the_brands_icon(): void
    {
        $brand = app(Brands::class)->setImage($this->account, 'icon', $this->image(512, 512), null);

        foreach (PortalBootstrap::ICONS as $name => $variant) {
            $response = $this->get('https://acme.example.com/api/v1/portal/icons/'.$name)->assertOk()
                ->assertHeader('Content-Type', 'image/png')
                ->assertHeader('Cache-Control', 'max-age=3600, public');
            $this->assertSame(
                Storage::disk(BrandImages::DISK)->get($brand->icon->variants[$variant]['path']),
                $response->streamedContent(),
            );
        }
        $this->get('https://acme.example.com/api/v1/portal/icons/favicon.png')->assertNotFound();
    }

    public function test_a_brand_without_an_icon_is_sent_the_platforms_own_file(): void
    {
        $this->get('https://acme.example.com/api/v1/portal/icons/maskable-icon-512x512.png')->assertNoContent()
            ->assertHeader('X-Accel-Redirect', '/platform-files/maskable-icon-512x512.png');
    }

    private function bootstrap(string $host): TestResponse
    {
        return $this->get("https://{$host}/api/v1/portal/runtime-config.js")->assertOk();
    }

    /**
     * @return array<string, mixed>
     */
    private function config(TestResponse|string $response): array
    {
        $body = $response instanceof TestResponse ? (string) $response->getContent() : $response;
        $this->assertStringStartsWith('window.__IOT_CONFIG__ = {', $body);
        $this->assertStringEndsWith("};\n", $body);

        return json_decode(substr($body, strlen('window.__IOT_CONFIG__ = '), -2), true, flags: JSON_THROW_ON_ERROR);
    }
}
