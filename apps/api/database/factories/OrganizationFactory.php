<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Shared\Models\Organization;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Organization>
 */
class OrganizationFactory extends Factory
{
    protected $model = Organization::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $name = fake()->unique()->company();

        return [
            'name' => $name,
            'slug' => Str::slug($name).'-'.fake()->unique()->numerify('####'),
        ];
    }

    /**
     * Without this, each organization gets a billing account of its own (spec 023).
     */
    public function forBillingAccount(BillingAccount $account): static
    {
        return $this->state(['billing_account_id' => $account->getKey()]);
    }
}
