<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Domain\Billing\Models\BillingPlan;
use App\Domain\Billing\Models\PlanAllowance;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<BillingPlan>
 */
class BillingPlanFactory extends Factory
{
    protected $model = BillingPlan::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => fake()->unique()->words(2, true).' plan',
            'description' => null,
        ];
    }

    /**
     * @param  array<string, int|null>  $allowances  kind => value, null for unlimited
     */
    public function withAllowances(array $allowances): static
    {
        return $this->afterCreating(function (BillingPlan $plan) use ($allowances): void {
            foreach ($allowances as $kind => $value) {
                PlanAllowance::query()->insert(['billing_plan_id' => $plan->getKey(), 'kind' => $kind, 'value' => $value]);
            }
        });
    }

    public function archived(): static
    {
        return $this->state(['archived_at' => now()]);
    }
}
