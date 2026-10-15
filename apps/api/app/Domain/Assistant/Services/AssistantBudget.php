<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Services;

use App\Domain\Assistant\Models\AssistantRun;
use Illuminate\Support\Facades\DB;

final class AssistantBudget
{
    public function reserve(): float
    {
        $day = now()->toDateString();
        DB::table('assistant_budgets')->insertOrIgnore(['day' => $day]);
        $budget = DB::table('assistant_budgets')->where('day', $day)->lockForUpdate()->first();
        $provider = app(AssistantProvider::class);
        $amount = $provider->runBudget();
        abort_unless($amount > 0 && (float) $budget->spent_usd + (float) $budget->reserved_usd + $amount <= $provider->dailyBudget(), 429, 'The assistant has reached its configured daily testing allowance. Try again later or adjust the server allowance.');
        DB::table('assistant_budgets')->where('day', $day)->increment('reserved_usd', $amount);

        return $amount;
    }

    public function finish(AssistantRun $run, float $cost): void
    {
        DB::transaction(function () use ($run, $cost): void {
            $locked = AssistantRun::query()->lockForUpdate()->find($run->id);
            if (! $locked || $locked->reserved_usd <= 0) {
                return;
            }
            $day = $locked->created_at->toDateString();
            DB::table('assistant_budgets')->where('day', $day)->lockForUpdate()->first();
            DB::table('assistant_budgets')->where('day', $day)->decrement('reserved_usd', $locked->reserved_usd);
            DB::table('assistant_budgets')->where('day', $day)->increment('spent_usd', $cost);
            $locked->update(['reserved_usd' => 0, 'cost_usd' => $cost]);
        });
    }

    /**
     * @param  array<string, mixed>  $usage
     */
    public function cost(array $usage, ?string $model = null): float
    {
        return app(AssistantProvider::class)->cost($usage, $model);
    }
}
