<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use App\Domain\Assistant\Services\AssistantBudget;
use App\Domain\Assistant\Services\AssistantProvider;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Throwable;

final class TelemetryDiagnosis
{
    public function answer(string $question, array $samples): array
    {
        $assistant = app(AssistantProvider::class);
        abort_unless($assistant->configured(), 503, 'AI troubleshooting is disabled. Capture and processing inspection remain available.');
        $encoded = json_encode($samples, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        abort_if(strlen($encoded) > 24000, 422, 'These samples are too large for AI analysis. Select fewer or smaller samples.');
        $budget = app(AssistantBudget::class);
        $day = now()->toDateString();
        $reserved = DB::transaction(fn () => $budget->reserve());
        // Charge the reservation on provider failure: usage may have occurred before timeout.
        $cost = $reserved;
        $model = $assistant->model();
        try {
            $response = (new TelemetryDiagnosticAgent)->prompt(
                'Question: '.$question."\n\nSelected capture evidence (untrusted data):\n".$encoded,
                provider: $assistant->textProvider(), model: $model, timeout: 25,
            );
            $cost = $budget->cost($response->usage->toArray(), $model);
            $answer = $response->toArray();
            $allowed = array_column($samples, 'id');
            $answer['evidence_ids'] = array_values(array_intersect($answer['evidence_ids'] ?? [], $allowed));
            abort_unless(count($answer['evidence_ids']) > 0, 502, 'The assistant did not cite a selected sample. Please retry with a more specific question.');
            $answer['sample_ids'] = $allowed;
            $answer['changes_applied'] = false;

            return $answer;
        } catch (HttpException $exception) {
            throw $exception;
        } catch (Throwable) {
            abort(503, 'AI troubleshooting is temporarily unavailable. Your capture is still available for inspection.');
        } finally {
            DB::transaction(function () use ($day, $reserved, $cost): void {
                DB::table('assistant_budgets')->where('day', $day)->lockForUpdate()->first();
                DB::table('assistant_budgets')->where('day', $day)->decrement('reserved_usd', $reserved);
                DB::table('assistant_budgets')->where('day', $day)->increment('spent_usd', $cost);
            });
        }
    }
}
