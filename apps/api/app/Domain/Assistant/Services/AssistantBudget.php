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
        $amount = (float) config('assistant.run_budget_usd');
        abort_unless($amount > 0 && (float) $budget->spent_usd + (float) $budget->reserved_usd + $amount <= (float) config('assistant.daily_budget_usd'), 429, 'The assistant has reached its configured daily testing allowance. Try again later or adjust the server allowance.');
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

    public function cost(array $usage): float
    {
        // Laravel AI 1.x totals already include cached input and reasoning output; rows
        // stored before 1.x use prompt/completion keys that excluded cached input.
        $input = array_key_exists('input_tokens', $usage)
            ? $usage['input_tokens'] ?? 0
            : ($usage['prompt_tokens'] ?? 0) + ($usage['cache_read_input_tokens'] ?? 0) + ($usage['cache_write_input_tokens'] ?? 0);
        $output = $usage['output_tokens'] ?? $usage['completion_tokens'] ?? 0;

        return round(($input * 0.75 + $output * 4.5) / 1000000, 6);
    }
}
