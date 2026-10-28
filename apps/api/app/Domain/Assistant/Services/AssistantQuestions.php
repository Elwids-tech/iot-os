<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Services;

use App\Domain\Assistant\Models\AssistantRun;
use Illuminate\Support\Facades\Validator;

/** The ask_questions tool shared by the assistants: 1–3 questions with choices. */
final class AssistantQuestions
{
    public function ask(AssistantRun $run, array $arguments): array
    {
        $data = Validator::make($arguments, [
            'questions' => ['required', 'array', 'min:1', 'max:3'],
            'questions.*.id' => ['required', 'string', 'max:80'],
            'questions.*.prompt' => ['required', 'string', 'max:800'],
            'questions.*.required' => ['required', 'boolean'],
            'questions.*.options' => ['required', 'array', 'max:7'],
            'questions.*.options.*' => ['string', 'max:200'],
        ])->validate();
        $conversation = $run->conversation;
        $conversation->update(['onboarding_state' => [...($conversation->fresh()->onboarding_state ?? []), 'questions' => $data['questions']]]);
        app(AssistantEvents::class)->emit($conversation, $run, 'questions', $data);

        return ['shown' => true, 'questions' => $data['questions']];
    }
}
