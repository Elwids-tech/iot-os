<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Enums\PlanAssignmentKind;
use App\Domain\Billing\Models\AllowanceOverride;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\BillingPlan;
use App\Domain\Billing\Models\PlanAssignment;
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
        ];
    }

    /**
     * The organization limit as an override (ADR-035); the deployment default is 1.
     */
    public function limit(?int $limit): static
    {
        return $this->afterCreating(function (BillingAccount $account) use ($limit): void {
            AllowanceOverride::query()->insert([
                'billing_account_id' => $account->getKey(),
                'kind' => AllowanceKind::Organizations->value,
                'value' => $limit,
                'note' => 'Factory',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });
    }

    public function onPlan(BillingPlan $plan): static
    {
        return $this->afterCreating(function (BillingAccount $account) use ($plan): void {
            PlanAssignment::query()->create([
                'billing_account_id' => $account->getKey(),
                'billing_plan_id' => $plan->getKey(),
                'kind' => PlanAssignmentKind::Paid,
                'started_at' => now(),
            ]);
        });
    }

    public function ownedBy(User $user): static
    {
        return $this->afterCreating(function (BillingAccount $account) use ($user): void {
            $account->owners()->attach($user->getKey(), ['created_at' => now()]);
        });
    }
}
