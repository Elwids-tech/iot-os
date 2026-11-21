<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Branding;

use App\Domain\Audit\Models\Activity;
use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\Allowances;
use App\Domain\Branding\Models\BrandAsset;
use App\Domain\Branding\Services\BrandImages;
use App\Domain\Branding\Services\Brands;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/** An organization shows its own logo, else its billing account's brand, else the platform's name (spec 036 US2, FR-004). */
final class OrganizationLogoTest extends TestCase
{
    use BrandImageFixtures, RefreshDatabase;

    private Organization $acme;

    private Organization $northstar;

    /** Administrator of Acme, moderator of Northstar. */
    private User $administrator;

    private User $member;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        Notification::fake();
        Storage::fake(BrandImages::DISK);
        $this->acme = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $this->administrator = User::where('email', 'shared.operator@example.test')->firstOrFail();
        $this->member = User::where('email', 'acme.member@example.test')->firstOrFail();
    }

    public function test_an_administrator_uploads_replaces_and_removes_the_logo(): void
    {
        $this->actingAs($this->administrator, 'sanctum');

        $url = $this->upload($this->acme, 'logo', 640, 160)->assertOk()
            ->assertJsonPath('data.logo.width', 480)
            ->assertJsonPath('data.logo_dark', null)
            ->assertJsonPath('data.brand.product_name', null)
            ->json('data.brand.logo.url');
        $this->get($url)->assertOk()->assertHeader('Content-Type', 'image/png');
        $first = BrandAsset::query()->sole();
        $this->assertSame($this->acme->id, $first->organization_id);
        $this->assertNull($first->billing_account_id);

        $this->upload($this->acme, 'logo/dark', 300, 100)->assertOk()->assertJsonPath('data.brand.logo_dark.width', 300);
        $this->upload($this->acme, 'logo', 200, 100)->assertOk()->assertJsonPath('data.logo.width', 200);
        $this->assertNotNull($first->fresh()->replaced_at);

        $this->getJson("/api/v1/organizations/{$this->acme->uuid}/context")->assertOk()->assertJsonPath('data.brand.logo.width', 200);
        $this->getJson('/api/v1/me')->assertOk();

        $this->deleteJson("/api/v1/organizations/{$this->acme->uuid}/logo")->assertOk()
            ->assertJsonPath('data.logo', null)
            // Without its own logo, its dark logo alone is not shown.
            ->assertJsonPath('data.brand.logo', null)
            ->assertJsonPath('data.brand.logo_dark', null);
        $this->deleteJson("/api/v1/organizations/{$this->acme->uuid}/logo/dark")->assertOk()->assertJsonPath('data.logo_dark', null);

        $entries = Activity::query()->where('event', 'organization.logo_changed')->orderBy('id')->get();
        $this->assertCount(5, $entries);
        $this->assertSame([$this->acme->id], $entries->pluck('organization_id')->unique()->all());
        $this->assertSame($this->administrator->id, (int) $entries[0]->causer_id);
        $this->assertSame(['image' => 'logo_dark', 'change' => 'removed'], $entries[4]->properties->only(['image', 'change'])->all());
    }

    public function test_only_people_who_may_update_the_organization_change_its_logo(): void
    {
        // A member without Organization.update.
        $this->actingAs($this->member, 'sanctum');
        $this->upload($this->acme, 'logo', 300, 100)->assertForbidden();
        $this->deleteJson("/api/v1/organizations/{$this->acme->uuid}/logo")->assertForbidden();

        // An administrator of one organization is only a moderator of the other.
        $this->actingAs($this->administrator, 'sanctum');
        $this->upload($this->northstar, 'logo', 300, 100)->assertForbidden();
        $this->upload($this->northstar, 'logo/dark', 300, 100)->assertForbidden();

        // Someone who belongs to neither.
        $this->actingAs(User::factory()->create(), 'sanctum');
        $this->upload($this->acme, 'logo', 300, 100)->assertForbidden();

        $this->assertSame(0, BrandAsset::query()->count());
    }

    public function test_a_refused_image_names_its_reason(): void
    {
        $this->actingAs($this->administrator, 'sanctum');

        $this->post("/api/v1/organizations/{$this->acme->uuid}/logo", ['image' => $this->file('logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>')], ['Accept' => 'application/json'])
            ->assertUnprocessable()->assertJsonPath('code', 'image_type')->assertJsonValidationErrors('image');
        $this->upload($this->acme, 'logo', 2400, 300)->assertUnprocessable()->assertJsonPath('code', 'image_too_large');
    }

    public function test_the_logo_falls_back_to_the_accounts_brand_only_while_it_is_in_effect(): void
    {
        $account = BillingAccount::query()->findOrFail($this->acme->billing_account_id);
        $sibling = Organization::factory()->forBillingAccount($account)->create(['name' => 'Acme West']);
        $brands = app(Brands::class);
        $staff = User::factory()->create(['is_super_admin' => true]);
        $brands->update($account, ['product_name' => 'Acme Monitor'], 0, $staff);
        $brands->setImage($account, BrandAsset::LOGO, $this->image(480, 120), $staff);
        $brands->setImage($account, BrandAsset::LOGO_DARK, $this->image(240, 60), $staff);
        $context = fn (Organization $organization): array => $this->actingAs($staff, 'sanctum')->getJson("/api/v1/organizations/{$organization->uuid}/context")->assertOk()->json('data.brand');

        // The brand is saved but branding is not part of the plan: the platform's name shows.
        $this->assertSame(['product_name' => null, 'logo' => null, 'logo_dark' => null], $context($sibling));

        app(Allowances::class)->override($account, AllowanceKind::Branding, 1, 'Test', $staff);
        $shown = $context($sibling);
        $this->assertSame('Acme Monitor', $shown['product_name']);
        $this->assertSame([480, 240], [$shown['logo']['width'], $shown['logo_dark']['width']]);
        // Another account's organization is untouched.
        $this->assertSame(['product_name' => null, 'logo' => null, 'logo_dark' => null], $context($this->northstar));

        // Its own logo wins, and the account's dark logo is not mixed with it.
        $brands->setOrganizationLogo($sibling, BrandAsset::LOGO, $this->image(100, 50), $staff);
        $shown = $context($sibling->refresh());
        $this->assertSame(['Acme Monitor', 100, null], [$shown['product_name'], $shown['logo']['width'], $shown['logo_dark']]);

        // Removing it shows the account's again; a brand without a name is not in effect.
        $brands->removeOrganizationLogo($sibling, BrandAsset::LOGO, $staff);
        $this->assertSame(480, $context($sibling->refresh())['logo']['width']);
        $brands->update($account, ['product_name' => null], $brands->for($account)->revision, $staff);
        $this->assertSame(['product_name' => null, 'logo' => null, 'logo_dark' => null], $context($sibling));

        // The session lists every organization with its resolved brand.
        $brands->update($account, ['product_name' => 'Acme Monitor'], $brands->for($account)->revision, $staff);
        $organizations = collect($this->actingAs($this->administrator, 'sanctum')->getJson('/api/v1/me')->assertOk()->json('data.organizations'))->keyBy('slug');
        $this->assertSame('Acme Monitor', $organizations['acme-manufacturing']['brand']['product_name']);
        $this->assertNull($organizations['northstar-utilities']['brand']['product_name']);
    }

    private function upload(Organization $organization, string $path, int $width, int $height): TestResponse
    {
        return $this->post("/api/v1/organizations/{$organization->uuid}/{$path}", ['image' => $this->image($width, $height)], ['Accept' => 'application/json']);
    }
}
