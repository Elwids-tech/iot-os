<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Branding;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Branding\Exceptions\BrandingRefusal;
use App\Domain\Branding\Models\BrandAsset;
use App\Domain\Branding\Services\BrandImages;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/** Brand images are checked by content, re-encoded and stored in fixed sizes (spec 036 FR-005, research R2). */
final class BrandImagesTest extends TestCase
{
    use BrandImageFixtures, RefreshDatabase;

    private BillingAccount $account;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake(BrandImages::DISK);
        $this->account = BillingAccount::factory()->create();
    }

    public function test_a_logo_is_scaled_to_fit_and_stored_as_png(): void
    {
        $asset = $this->store($this->image(1200, 300, 'jpeg'), BrandAsset::LOGO);

        $this->assertSame(['logo'], array_keys($asset->variants));
        $this->assertSame([480, 120], [$asset->variants['logo']['width'], $asset->variants['logo']['height']]);
        $stored = Storage::disk(BrandImages::DISK)->get($asset->variants['logo']['path']);
        $this->assertSame('image/png', (new \finfo(FILEINFO_MIME_TYPE))->buffer($stored));
        $this->assertSame(strlen($stored), $asset->variants['logo']['bytes']);
        $this->assertSame(64, strlen($asset->content_hash));

        // A small logo is never scaled up.
        $small = $this->store($this->image(200, 50, 'webp'), BrandAsset::LOGO_DARK);
        $this->assertSame([200, 50], [$small->variants['logo']['width'], $small->variants['logo']['height']]);
    }

    public function test_an_icon_is_stored_in_every_size(): void
    {
        $asset = $this->store($this->image(600, 600), BrandAsset::ICON);

        $sizes = array_map(fn (array $variant): array => [$variant['width'], $variant['height']], $asset->variants);
        $this->assertSame(['512' => [512, 512], '192' => [192, 192], '64' => [64, 64], '180' => [180, 180], 'maskable' => [512, 512]], $sizes);

        // The maskable icon keeps the image inside the safe zone, on white.
        $maskable = imagecreatefromstring(Storage::disk(BrandImages::DISK)->get($asset->variants['maskable']['path']));
        $this->assertSame(['red' => 255, 'green' => 255, 'blue' => 255, 'alpha' => 0], imagecolorsforindex($maskable, imagecolorat($maskable, 5, 5)));
        $this->assertSame(['red' => 20, 'green' => 90, 'blue' => 200, 'alpha' => 0], imagecolorsforindex($maskable, imagecolorat($maskable, 256, 256)));
    }

    public function test_images_that_break_a_rule_are_refused_with_the_reason(): void
    {
        config(['branding.images.max_bytes' => 2000]);
        $this->assertRefused('image_too_large', $this->file('big.png', $this->image(64, 64)->getContent().str_repeat('0', 4000)), BrandAsset::LOGO);
        config(['branding.images.max_bytes' => 1048576]);

        $this->assertRefused('image_too_large', $this->image(2001, 100), BrandAsset::LOGO);
        $this->assertRefused('image_not_square', $this->image(600, 520), BrandAsset::ICON);
        $this->assertRefused('image_too_small', $this->image(256, 256), BrandAsset::ICON);
        $this->assertRefused('image_type', $this->file('logo.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>'), BrandAsset::LOGO);
        $this->assertRefused('image_type', $this->file('logo.png', '<html><body><script>alert(1)</script></body></html>'), BrandAsset::LOGO);
        $this->assertRefused('image_type', $this->file('logo.gif', "GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;"), BrandAsset::LOGO);

        $this->assertSame(0, BrandAsset::query()->count());
        $this->assertSame([], Storage::disk(BrandImages::DISK)->allFiles());

        // 2% off square is cropped, not refused.
        $this->assertSame(512, $this->store($this->image(600, 590), BrandAsset::ICON)->variants['512']['height']);
    }

    public function test_nothing_but_pixels_survives_re_encoding(): void
    {
        $upload = $this->pngWithText(100, 40, 'secret-location-51.5,-0.1');
        $this->assertStringContainsString('secret-location', $upload->getContent());

        $asset = $this->store($upload, BrandAsset::LOGO);

        $this->assertStringNotContainsString('secret-location', Storage::disk(BrandImages::DISK)->get($asset->variants['logo']['path']));
    }

    public function test_an_image_is_public_under_its_hashed_name_and_cached_for_a_year(): void
    {
        $asset = $this->store($this->image(600, 600), BrandAsset::ICON);

        $response = $this->get("/api/v1/brand-assets/{$asset->publicKey()}/192")->assertOk();
        $response->assertHeader('Content-Type', 'image/png');
        $response->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->assertSame('31536000', $response->headers->getCacheControlDirective('max-age'));
        $this->assertTrue($response->headers->hasCacheControlDirective('public'));
        $this->assertTrue($response->headers->hasCacheControlDirective('immutable'));
        $this->assertSame($asset->url('192'), url("/api/v1/brand-assets/{$asset->publicKey()}/192"));

        // A wrong hash, an unknown size and an unknown image all answer 404.
        $this->get('/api/v1/brand-assets/'.$asset->uuid.str_repeat('0', 12).'/192')->assertNotFound();
        $this->get("/api/v1/brand-assets/{$asset->publicKey()}/999")->assertNotFound();
        $this->get('/api/v1/brand-assets/'.fake()->uuid().substr($asset->content_hash, 0, 12).'/192')->assertNotFound();
        $this->get("/api/v1/brand-assets/{$asset->uuid}/192")->assertNotFound();
    }

    public function test_a_replaced_image_is_pruned_a_day_later(): void
    {
        $images = app(BrandImages::class);
        $old = $this->store($this->image(300, 100), BrandAsset::LOGO);
        $current = $this->store($this->image(300, 100), BrandAsset::LOGO);
        $images->retire($old);

        $this->artisan('branding:prune-assets')->assertSuccessful();
        $this->assertNotNull($old->fresh());
        $this->get("/api/v1/brand-assets/{$old->publicKey()}/logo")->assertOk();

        $this->artisan('branding:prune-assets', ['--now' => CarbonImmutable::now()->addHours(25)->toIso8601String()])->assertSuccessful();
        $this->assertNull($old->fresh());
        $this->assertNotNull($current->fresh());
        $this->assertFalse(Storage::disk(BrandImages::DISK)->exists($old->variants['logo']['path']));
        $this->assertTrue(Storage::disk(BrandImages::DISK)->exists($current->variants['logo']['path']));
        $this->get("/api/v1/brand-assets/{$old->publicKey()}/logo")->assertNotFound();
    }

    public function test_files_of_a_deleted_account_are_swept_a_day_later(): void
    {
        $asset = $this->store($this->image(300, 100), BrandAsset::LOGO);
        $kept = app(BrandImages::class)->store($this->image(300, 100), BrandAsset::LOGO, BillingAccount::factory()->create(), null);
        DB::table('billing_accounts')->where('id', $this->account->id)->delete();
        $this->assertNull($asset->fresh());

        // Recent files are left alone: an upload writes them just before its row.
        $this->artisan('branding:prune-assets')->assertSuccessful();
        $this->assertTrue(Storage::disk(BrandImages::DISK)->exists($asset->variants['logo']['path']));

        $this->artisan('branding:prune-assets', ['--now' => CarbonImmutable::now()->addHours(25)->toIso8601String()])->assertSuccessful();
        $this->assertFalse(Storage::disk(BrandImages::DISK)->exists($asset->variants['logo']['path']));
        $this->assertTrue(Storage::disk(BrandImages::DISK)->exists($kept->variants['logo']['path']));
    }

    private function store(UploadedFile $file, string $role): BrandAsset
    {
        return app(BrandImages::class)->store($file, $role, $this->account, null);
    }

    private function assertRefused(string $code, UploadedFile $file, string $role): void
    {
        try {
            $this->store($file, $role);
            $this->fail("Expected {$code}.");
        } catch (BrandingRefusal $refusal) {
            $this->assertSame($code, $refusal->refusal);
            $this->assertSame(422, $refusal->getResponse()->getStatusCode());
        }
    }
}
