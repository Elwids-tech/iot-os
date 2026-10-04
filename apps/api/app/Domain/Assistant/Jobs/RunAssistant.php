<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Jobs;

use App\Domain\Assistant\Agents\ProfileAssistant;
use App\Domain\Assistant\Agents\WorkflowAssistant;
use App\Domain\Assistant\Models\AssistantRun;
use App\Domain\Assistant\Services\AssistantAccess;
use App\Domain\Assistant\Services\AssistantBudget;
use App\Domain\Assistant\Services\AssistantEvents;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\Storage;
use Laravel\Ai\Approvals\Decision;
use Laravel\Ai\Approvals\Decisions;
use Laravel\Ai\Enums\Lab;
use Laravel\Ai\Files;
use Laravel\Ai\Responses\Data\Usage;
use Laravel\Ai\Responses\StreamedAgentResponse;
use Laravel\Ai\Streaming\Events\StreamEnd;
use Laravel\Ai\Streaming\Events\TextDelta;
use Laravel\Ai\Streaming\Events\ToolApprovalRequest;
use RuntimeException;
use Throwable;

final class RunAssistant implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 120;

    public function __construct(public readonly string $runId)
    {
        $this->onConnection(config('assistant.queue_connection'));
        $this->onQueue('assistant');
    }

    public function handle(): void
    {
        $claimed = AssistantRun::query()->whereKey($this->runId)->where('status', 'queued')->update(['status' => 'running', 'started_at' => now()]);
        if (! $claimed) {
            return;
        }
        $run = AssistantRun::query()->findOrFail($this->runId);
        $conversation = $run->conversation;
        $events = app(AssistantEvents::class);
        $usage = new Usage;
        $buffer = '';
        $answer = '';
        $lastFlush = microtime(true);
        try {
            app(AssistantAccess::class)->conversation($conversation->user, $conversation->organization, $conversation);
            abort_unless(config('assistant.enabled'), 503, 'Assistant unavailable.');
            $events->emit($conversation, $run, 'status', ['status' => 'running']);
            $automation = $conversation->scope === 'automation';
            $agent = $automation ? new WorkflowAssistant($run) : new ProfileAssistant($run);
            if (! $automation && $conversation->sdk_conversation_id) {
                $agent->continue($conversation->sdk_conversation_id, as: $conversation->user);
            } elseif (! $automation) {
                $agent->forUser($conversation->user);
            }
            $prompt = $run->prompt ?? '';
            if ($run->decisions) {
                $decisions = [];
                foreach ($run->decisions as $id => $decision) {
                    $decisions[$id] = $decision['action'] === 'reject' ? Decision::reject($decision['reason'] ?? 'The user dismissed this proposal. Ask what they want changed.') : Decision::edit($decision['arguments']);
                }
                $prompt = Decisions::from($decisions);
            }
            $attachments = $conversation->sources()->whereIn('id', $run->source_ids ?? [])->get()->filter(fn ($source) => $source->mime === 'application/pdf' || str_starts_with($source->mime, 'image/'))->map(function ($source) {
                return str_starts_with($source->mime, 'image/') ? Files\Image::fromPath(Storage::disk('local')->path($source->path))->as($source->name) : Files\Document::fromPath(Storage::disk('local')->path($source->path))->as($source->name);
            })->all();
            abort_unless($run->fresh()?->status === 'running', 409, 'assistant.cancelled');
            $response = $agent->stream($prompt, attachments: $attachments, provider: Lab::OpenAI, model: config('assistant.model'));
            $response->then(function (StreamedAgentResponse $result) use ($conversation, $automation): void {
                if ($automation) {
                    return;
                }
                $conversation->update(['sdk_conversation_id' => $result->conversationId, 'sdk_pending_approvals' => $result->pendingApprovals->toArray()]);
                foreach ($result->pendingApprovals as $approval) {
                    if ($approval->tool === 'ApplyProfileSection') {
                        $conversation->proposals()->whereKey($approval->arguments['proposal_id'] ?? '')->where('status', 'pending')->update(['approval_id' => $approval->id]);
                    }
                }
            });
            foreach ($response as $event) {
                if ($run->fresh()?->status !== 'running') {
                    throw new RuntimeException('assistant.cancelled');
                }
                if ($event instanceof TextDelta) {
                    $answer .= $event->delta;
                    $buffer .= $event->delta;
                }
                if ($event instanceof StreamEnd) {
                    $usage = $usage->add($event->usage);
                    if (app(AssistantBudget::class)->cost($usage->toArray()) > config('assistant.run_budget_usd')) {
                        throw new RuntimeException('assistant.run_budget');
                    }
                }
                if ($buffer !== '' && microtime(true) - $lastFlush >= 0.25) {
                    $run->update(['answer' => $answer]);
                    $events->emit($conversation, $run, 'text_delta', ['delta' => $buffer]);
                    $buffer = '';
                    $lastFlush = microtime(true);
                }
            }
            if ($buffer !== '') {
                $events->emit($conversation, $run, 'text_delta', ['delta' => $buffer]);
            }
            if ($run->fresh()?->status !== 'running') {
                throw new RuntimeException('assistant.cancelled');
            }
            $status = $response->events->contains(fn ($e) => $e instanceof ToolApprovalRequest) ? 'awaiting_approval' : 'completed';
            $run->update(['status' => $status, 'answer' => $response->text ?? $answer, 'usage' => $usage->toArray(), 'finished_at' => now()]);
            $conversation->touch();
            $events->emit($conversation, $run, 'status', ['status' => $status]);
        } catch (Throwable $exception) {
            $run = $run->fresh();
            if ($run) {
                $cancelled = $run->status === 'cancelled';
                $code = $cancelled ? 'assistant.cancelled' : ($exception->getMessage() === 'assistant.run_budget' ? 'assistant.run_budget' : 'assistant.generation_failed');
                $message = $cancelled ? 'Generation stopped. Your saved work is kept.' : ($code === 'assistant.run_budget' ? 'This response reached the configured run allowance. Continue with a smaller request.' : 'The assistant could not finish this response. Your saved work and review proposals are safe. Retry with a smaller request, or check the provider credit and server configuration.');
                $run->update(['status' => $cancelled ? 'cancelled' : 'failed', 'answer' => $answer, 'usage' => $usage->toArray(), 'error_code' => $code, 'error_message' => $message, 'finished_at' => now()]);
                $events->emit($conversation, $run, 'status', ['status' => $run->status, 'message' => $message]);
                $providerError = $exception instanceof RequestException ? $exception->response->json('error') : null;
                $providerMessage = is_array($providerError) ? mb_substr((string) ($providerError['message'] ?? ''), 0, 600) : null;
                if ($providerMessage) {
                    $providerMessage = str_replace((string) config('ai.providers.openai.key'), '[redacted]', $providerMessage);
                }
                logger()->warning('Assistant run did not complete.', ['run_id' => $run->id, 'code' => $code, 'exception_type' => $exception::class, 'provider_status' => $exception instanceof RequestException ? $exception->response->status() : null, 'provider_code' => $providerError['code'] ?? null, 'provider_message' => $providerMessage]);
            }
        } finally {
            if ($run) {
                app(AssistantBudget::class)->finish($run, app(AssistantBudget::class)->cost($usage->toArray()));
            }
        }
    }

    public function failed(?Throwable $exception): void
    {
        $run = AssistantRun::query()->find($this->runId);
        if ($run && $run->reserved_usd > 0) {
            $run->update(['status' => 'failed', 'error_code' => 'assistant.worker_stopped', 'error_message' => 'The worker stopped before this response completed. Check the saved draft before retrying.', 'finished_at' => now()]);
            app(AssistantBudget::class)->finish($run, $run->reserved_usd);
        }
    }
}
