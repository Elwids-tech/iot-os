<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Branding;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Branding\Models\Brand;
use App\Domain\Branding\Services\Brands;
use App\Domain\Firmware\Services\MetricTables;
use App\Domain\Shared\Models\Organization;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The product's name in text written for an organization (spec 036, FR-009): assistant
 * prompts and generated firmware text call it what the organization's account does.
 */
final class ProductNameTest extends TestCase
{
    use PortalAddressFixtures, RefreshDatabase;

    public function test_it_is_the_accounts_brand_while_that_is_in_effect_and_the_platforms_otherwise(): void
    {
        config(['branding.platform_name' => 'IoT OS']);
        $account = $this->brandedAccountWithoutAddress('Acme Monitor');
        $branded = Organization::factory()->forBillingAccount($account)->create();
        $plain = Organization::factory()->create();
        $brands = app(Brands::class);

        $this->assertSame('Acme Monitor', $brands->nameFor($branded));
        $this->assertSame('IoT OS', $brands->nameFor($plain));
        $this->assertSame('IoT OS', $brands->nameFor());

        $this->allow($account, value: 0);
        $this->assertSame('IoT OS', app()->make(Brands::class)->nameFor($branded->fresh()));
    }

    public function test_generated_firmware_text_names_the_product_of_the_organization_the_request_is_about(): void
    {
        $account = $this->brandedAccountWithoutAddress('Acme */ Monitor');
        request()->attributes->set('organization', Organization::factory()->forBillingAccount($account)->create());

        // Safe inside a C comment.
        $this->assertSame('Acme * / Monitor', app(MetricTables::class)->product());
    }

    private function brandedAccountWithoutAddress(string $productName): BillingAccount
    {
        $account = BillingAccount::factory()->create();
        $this->allow($account);
        Brand::query()->create(['billing_account_id' => $account->getKey(), 'product_name' => $productName, 'revision' => 1]);

        return $account;
    }
}
