<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Services;

use App\Domain\Assistant\Models\AssistantConversation;
use App\Domain\Assistant\Models\AssistantRun;
use Illuminate\Support\Facades\DB;
use Laravel\Ai\Approvals\PendingApproval;
use Laravel\Ai\Enums\MessageStatus;

final class AssistantRecovery
{
    public function recover(?AssistantConversation $conversation = null): void
    {
        $runs = AssistantRun::query()->where('reserved_usd', '>', 0)
            ->when($conversation, fn ($query) => $query->where('conversation_id', $conversation->id))
            ->where('created_at', '<', now()->subMinutes(5))->get();
        foreach ($runs as $run) {
            DB::transaction(function () use ($run): void {
                $locked = AssistantRun::query()->lockForUpdate()->find($run->id);
                if (! $locked || $locked->reserved_usd <= 0) {
                    return;
                }
                $cost = $locked->started_at ? $locked->reserved_usd : 0;
                $locked->update(['status' => $locked->status === 'cancelled' ? 'cancelled' : 'failed', 'error_code' => 'assistant.worker_stopped', 'error_message' => 'The response did not finish. Saved sections are kept; you can send another message.', 'finished_at' => now()]);
                app(AssistantBudget::class)->finish($locked, $cost);
                app(AssistantEvents::class)->emit($locked->conversation, $locked, 'status', ['status' => $locked->status, 'message' => $locked->error_message]);
            });
        }
    }

    /** SDK approval results are durable even when subsequent generation fails. */
    public function pending(AssistantConversation $conversation): array
    {
        if (! $conversation->sdk_conversation_id) {
            return [];
        }
        $pending = DB::table('agent_conversation_messages')->where('conversation_id', $conversation->sdk_conversation_id)
            ->where('status', MessageStatus::Paused->value)->get(['steps'])->flatMap(function ($row) {
                return collect(json_decode($row->steps, true))->flatMap(fn ($step) => $step['tool_calls'] ?? [])
                    ->filter(fn ($call) => PendingApproval::isPending($call))
                    ->map(fn ($call) => ['id' => $call['id'], 'tool' => $call['name'], 'arguments' => $call['arguments']]);
            })->values()->all();
        $conversation->update(['sdk_pending_approvals' => $pending]);

        return $pending;
    }
}
