<?php

declare(strict_types=1);

namespace Tests\Unit\Domain\Assistant;

use App\Domain\Assistant\Services\AssistantBudget;
use Laravel\Ai\Responses\Data\TextUsage;
use Tests\TestCase;

final class AssistantBudgetTest extends TestCase
{
    public function test_laravel_ai_usage_totals_are_charged_including_cached_input_and_reasoning(): void
    {
        $usage = (new TextUsage(1000, 200, cacheReadInputTokens: 400, reasoningTokens: 50))->toArray();

        // 1000 input at $0.75/M (cached input counted at the normal rate) + 200 output at $4.50/M.
        $this->assertSame(0.00165, app(AssistantBudget::class)->cost($usage));
    }

    public function test_usage_stored_before_laravel_ai_1_keeps_its_original_cost(): void
    {
        $usage = ['prompt_tokens' => 600, 'completion_tokens' => 200, 'cache_read_input_tokens' => 400, 'cache_write_input_tokens' => 0];

        $this->assertSame(0.00165, app(AssistantBudget::class)->cost($usage));
    }
}
