<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<BillingAccount>
 */
class BillingAccountFactory extends Factory
{
    protected $model = BillingAccount::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => fake()->company(),
            'organization_limit' => 1,
        ];
    }

    public function limit(int $limit): static
    {
        return $this->state(['organization_limit' => $limit]);
    }

    public function ownedBy(User $user): static
    {
        return $this->afterCreating(function (BillingAccount $account) use ($user): void {
            $account->owners()->attach($user->getKey(), ['created_at' => now()]);
        });
    }
}
