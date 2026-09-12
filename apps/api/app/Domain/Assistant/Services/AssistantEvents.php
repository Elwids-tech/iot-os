<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Services;

use App\Domain\Assistant\Models\AssistantConversation;
use App\Domain\Assistant\Models\AssistantRun;
use Illuminate\Support\Facades\DB;

final class AssistantEvents
{
    public function emit(AssistantConversation $conversation, ?AssistantRun $run, string $type, array $payload): void
    {
        DB::table('assistant_events')->insert([
            'conversation_id' => $conversation->id, 'run_id' => $run?->id,
            'type' => $type, 'payload' => json_encode($payload, JSON_THROW_ON_ERROR), 'created_at' => now(),
        ]);
    }
}
