<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Branding;

use App\Domain\Audit\Models\Activity;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Branding\Models\Brand;
use App\Domain\Branding\Models\BrandAsset;
use App\Domain\Branding\Services\BrandImages;
use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/** A billing account's owners set its brand; platform staff can do it for them (spec 036 US1, US6). */
final class BrandTest extends TestCase
{
    use BrandImageFixtures, RefreshDatabase;

    private User $owner;

    private User $administrator;

    private BillingAccount $account;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake(BrandImages::DISK);
        $this->owner = User::factory()->create();
        $this->administrator = User::factory()->create(['is_super_admin' => true]);
        $this->account = BillingAccount::factory()->ownedBy($this->owner)->create();
    }

    public function test_an_owner_reads_an_empty_brand_and_what_the_plan_allows(): void
    {
        $this->actingAs($this->owner, 'sanctum')->getJson($this->url('branding'))->assertOk()
            ->assertJsonPath('data.brand', ['product_name' => null, 'short_name' => null, 'support_url' => null, 'logo' => null, 'logo_dark' => null, 'icon' => null, 'in_effect' => false, 'revision' => 0])
            ->assertJsonPath('data.addresses', [])
            ->assertJsonPath('data.allowances', ['branding' => false, 'custom_domain' => false, 'hide_powered_by' => false])
            ->assertJsonPath('data.addresses_available', false)
            ->assertJsonPath('data.name_suffix', null)
            ->assertJsonPath('data.limits', ['image_bytes' => 1048576, 'types' => ['image/png', 'image/jpeg', 'image/webp'], 'icon_min' => 512]);
        $this->assertSame(0, Brand::query()->count());
    }

    public function test_an_owner_sets_the_brand_and_each_change_is_recorded(): void
    {
        $this->allow();
        $this->actingAs($this->owner, 'sanctum');

        $this->putJson($this->url('brand'), ['product_name' => 'Acme Monitor', 'short_name' => 'Acme', 'support_url' => 'https://support.example.org/help', 'revision' => 0])
            ->assertOk()
            ->assertJsonPath('data.product_name', 'Acme Monitor')
            ->assertJsonPath('data.in_effect', true)
            ->assertJsonPath('data.revision', 1);

        $logo = $this->post($this->url('brand/images/logo'), ['image' => $this->image(960, 240)], ['Accept' => 'application/json'])
            ->assertOk()
            ->assertJsonPath('data.logo.width', 480)
            ->assertJsonPath('data.logo.height', 120)
            ->assertJsonPath('data.revision', 2)
            ->json('data.logo.url');
        $this->get($logo)->assertOk()->assertHeader('Content-Type', 'image/png');

        $icon = $this->post($this->url('brand/images/icon'), ['image' => $this->image(512, 512)], ['Accept' => 'application/json'])
            ->assertOk()->assertJsonPath('data.icon.width', 512)->json('data.icon.url');
        $this->assertStringEndsWith('/512', $icon);

        // Replacing the logo retires the first; removing one clears it.
        $first = BrandAsset::query()->where('role', 'logo')->sole();
        $this->post($this->url('brand/images/logo'), ['image' => $this->image(300, 100)], ['Accept' => 'application/json'])->assertOk();
        $this->assertNotNull($first->fresh()->replaced_at);
        $this->deleteJson($this->url('brand/images/icon'))->assertOk()->assertJsonPath('data.icon', null);
        $this->deleteJson($this->url('brand/images/logo_dark'))->assertOk()->assertJsonPath('data.revision', 5);

        $this->getJson($this->url('branding'))->assertOk()
            ->assertJsonPath('data.brand.short_name', 'Acme')
            ->assertJsonPath('data.brand.logo.width', 300)
            ->assertJsonPath('data.allowances.branding', true);

        $entries = Activity::query()->where('subject_uuid', $this->account->uuid)->orderBy('id')->get();
        $this->assertSame(['billing_account.allowance_overridden', 'brand.updated', 'brand.image_changed', 'brand.image_changed', 'brand.image_changed', 'brand.image_changed'], $entries->pluck('event')->all());
        $this->assertSame($this->owner->id, (int) $entries[1]->causer_id);
        $this->assertSame(['product_name', 'short_name', 'support_url'], $entries[1]->properties['changed']);
        $this->assertSame(['image' => 'icon', 'change' => 'removed'], $entries[5]->properties->only(['image', 'change'])->all());
    }

    public function test_changes_are_refused_while_branding_is_not_part_of_the_plan(): void
    {
        $this->actingAs($this->owner, 'sanctum');

        $this->putJson($this->url('brand'), ['product_name' => 'Acme', 'short_name' => null, 'support_url' => null, 'revision' => 0])
            ->assertForbidden()->assertJsonPath('code', 'branding_not_allowed');
        $this->post($this->url('brand/images/logo'), ['image' => $this->image(300, 100)], ['Accept' => 'application/json'])
            ->assertForbidden()->assertJsonPath('code', 'branding_not_allowed');
        $this->deleteJson($this->url('brand/images/logo'))->assertForbidden()->assertJsonPath('code', 'branding_not_allowed');

        $this->assertSame(0, Brand::query()->count());
        $this->assertSame(0, BrandAsset::query()->count());
    }

    public function test_another_persons_account_answers_404(): void
    {
        $this->allow();
        $stranger = User::factory()->create();
        BillingAccount::factory()->ownedBy($stranger)->create();
        $this->actingAs($stranger, 'sanctum');

        $this->getJson($this->url('branding'))->assertNotFound();
        $this->putJson($this->url('brand'), ['product_name' => 'Theirs', 'short_name' => null, 'support_url' => null, 'revision' => 0])->assertNotFound();
        $this->post($this->url('brand/images/logo'), ['image' => $this->image(300, 100)], ['Accept' => 'application/json'])->assertNotFound();
        $this->deleteJson($this->url('brand/images/logo'))->assertNotFound();
        $this->getJson("/api/v1/admin/billing-accounts/{$this->account->uuid}/branding")->assertForbidden();
        $this->putJson("/api/v1/admin/billing-accounts/{$this->account->uuid}/brand", ['product_name' => 'Theirs', 'short_name' => null, 'support_url' => null, 'revision' => 0])->assertForbidden();
    }

    public function test_a_brand_changed_since_it_was_read_is_not_overwritten(): void
    {
        $this->allow();
        $this->actingAs($this->owner, 'sanctum');
        $this->putJson($this->url('brand'), ['product_name' => 'First', 'short_name' => null, 'support_url' => null, 'revision' => 0])->assertOk();

        $this->putJson($this->url('brand'), ['product_name' => 'Second', 'short_name' => null, 'support_url' => null, 'revision' => 0])
            ->assertConflict()->assertJsonPath('code', 'brand_changed');
        $this->assertSame('First', Brand::query()->sole()->product_name);

        // Saving the same values again records nothing and keeps the revision.
        $this->putJson($this->url('brand'), ['product_name' => 'First', 'short_name' => null, 'support_url' => null, 'revision' => 1])
            ->assertOk()->assertJsonPath('data.revision', 1);
        $this->assertSame(1, Activity::query()->where('event', 'brand.updated')->count());
    }

    public function test_names_and_the_support_link_are_checked(): void
    {
        $this->allow();
        $this->actingAs($this->owner, 'sanctum');
        $body = fn (array $values): array => [...['product_name' => 'Acme', 'short_name' => null, 'support_url' => null, 'revision' => 0], ...$values];

        $this->putJson($this->url('brand'), $body(['product_name' => str_repeat('a', 41)]))->assertUnprocessable()->assertJsonValidationErrors('product_name');
        $this->putJson($this->url('brand'), $body(['short_name' => str_repeat('a', 13)]))->assertUnprocessable()->assertJsonValidationErrors('short_name');
        foreach (['http://support.example.org', 'javascript:alert(1)', 'support.example.org', 'mailto:not-an-address', 'https://'] as $link) {
            $this->putJson($this->url('brand'), $body(['support_url' => $link]))->assertUnprocessable()->assertJsonValidationErrors('support_url');
        }
        $this->putJson($this->url('brand'), ['product_name' => 'Acme'])->assertUnprocessable()->assertJsonValidationErrors(['short_name', 'support_url', 'revision']);
        $this->assertSame(0, Brand::query()->count());

        $this->putJson($this->url('brand'), $body(['product_name' => str_repeat('a', 40), 'short_name' => str_repeat('b', 12), 'support_url' => 'mailto:help@example.org']))
            ->assertOk()->assertJsonPath('data.support_url', 'mailto:help@example.org');
    }

    public function test_a_refused_image_names_its_reason_and_changes_nothing(): void
    {
        $this->allow();
        $this->actingAs($this->owner, 'sanctum');

        $this->post($this->url('brand/images/icon'), ['image' => $this->image(600, 300)], ['Accept' => 'application/json'])
            ->assertUnprocessable()->assertJsonPath('code', 'image_not_square')->assertJsonValidationErrors('image');
        $this->post($this->url('brand/images/logo'), ['image' => $this->file('logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>')], ['Accept' => 'application/json'])
            ->assertUnprocessable()->assertJsonPath('code', 'image_type');
        $this->postJson($this->url('brand/images/logo'), [])->assertUnprocessable()->assertJsonValidationErrors('image');
        $this->postJson($this->url('brand/images/banner'), [])->assertNotFound();

        $this->assertSame(0, Brand::query()->count());
        $this->assertSame(0, Activity::query()->where('event', 'brand.image_changed')->count());
    }

    public function test_staff_edit_any_brand_and_it_takes_effect_only_with_the_allowance(): void
    {
        $this->actingAs($this->administrator, 'sanctum');
        $admin = "/api/v1/admin/billing-accounts/{$this->account->uuid}";

        $this->putJson("{$admin}/brand", ['product_name' => 'Acme Monitor', 'short_name' => null, 'support_url' => null, 'revision' => 0])
            ->assertOk()->assertJsonPath('data.in_effect', false);
        $this->post("{$admin}/brand/images/logo", ['image' => $this->image(300, 100)], ['Accept' => 'application/json'])->assertOk();
        $this->getJson("{$admin}/branding")->assertOk()->assertJsonPath('data.brand.in_effect', false)->assertJsonPath('data.allowances.branding', false);

        $this->allow();
        $this->getJson("{$admin}/branding")->assertOk()->assertJsonPath('data.brand.in_effect', true);

        // Withdrawing the allowance keeps the saved brand and takes it out of effect (FR-037).
        $this->deleteJson("{$admin}/allowances/branding")->assertOk();
        $this->getJson("{$admin}/branding")->assertOk()
            ->assertJsonPath('data.brand.product_name', 'Acme Monitor')
            ->assertJsonPath('data.brand.in_effect', false);
        $this->deleteJson("{$admin}/brand/images/logo")->assertOk()->assertJsonPath('data.logo', null);
    }

    public function test_deleting_the_account_deletes_its_brand(): void
    {
        $this->allow();
        $this->actingAs($this->owner, 'sanctum')->putJson($this->url('brand'), ['product_name' => 'Acme', 'short_name' => null, 'support_url' => null, 'revision' => 0])->assertOk();

        DB::table('billing_accounts')->where('id', $this->account->id)->delete();

        $this->assertSame(0, Brand::query()->count());
    }

    private function allow(): void
    {
        $this->actingAs($this->administrator, 'sanctum')
            ->putJson("/api/v1/admin/billing-accounts/{$this->account->uuid}/allowances/branding", ['value' => 1, 'note' => 'Test'])
            ->assertOk();
    }

    private function url(string $path): string
    {
        return "/api/v1/billing-accounts/{$this->account->uuid}/{$path}";
    }
}
