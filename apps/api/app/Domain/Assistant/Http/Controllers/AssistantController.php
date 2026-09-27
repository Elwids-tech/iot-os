<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Http\Controllers;

use App\Domain\Assistant\Jobs\RunAssistant;
use App\Domain\Assistant\Models\AssistantConversation;
use App\Domain\Assistant\Models\AssistantProposal;
use App\Domain\Assistant\Models\AssistantRun;
use App\Domain\Assistant\Models\AssistantSource;
use App\Domain\Assistant\Services\AssistantAccess;
use App\Domain\Assistant\Services\AssistantBudget;
use App\Domain\Assistant\Services\AssistantEvents;
use App\Domain\Assistant\Services\AssistantRecovery;
use App\Domain\Assistant\Services\ProfileKnowledge;
use App\Domain\Assistant\Services\ProfileProposalService;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Symfony\Component\Process\Process;

final class AssistantController
{
    public function __construct(private readonly AssistantAccess $access, private readonly ProfileProposalService $proposals) {}

    public function settings(Request $request, Organization $organization)
    {
        $this->access->organization($request->user(), $organization);

        return response()->json(['data' => [
            'enabled' => (bool) config('assistant.enabled') && filled(config('ai.providers.openai.key')),
            'capabilities' => $this->access->capabilities($request->user(), $organization),
            'schema' => app(ProfileKnowledge::class)->describe(),
            'supported_extensions' => ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'md', 'json', 'csv'],
            'max_file_bytes' => config('assistant.max_file_kib') * 1024,
        ]]);
    }

    public function index(Request $request, Organization $organization)
    {
        $this->access->organization($request->user(), $organization);
        $conversations = AssistantConversation::query()->where('organization_id', $organization->id)->where('user_id', $request->user()->id)->with('profile')->orderByDesc('updated_at')->limit(100)->get();

        return response()->json(['data' => $conversations->map(fn ($conversation) => $this->conversationData($conversation))]);
    }

    public function store(Request $request, Organization $organization)
    {
        $this->access->organization($request->user(), $organization);
        $values = $request->validate(['profile_uuid' => ['nullable', 'uuid'], 'title' => ['nullable', 'string', 'max:255']]);
        $profile = isset($values['profile_uuid']) ? $this->access->profile($request->user(), $organization, $values['profile_uuid']) : null;
        if (! $profile) {
            abort_unless($this->access->capabilities($request->user(), $organization)['create'] ?? false, 403);
        }
        $conversation = AssistantConversation::query()->create([
            'organization_id' => $organization->id, 'user_id' => $request->user()->id,
            'device_profile_id' => $profile?->id, 'title' => $values['title'] ?? $profile?->name ?? 'New profile conversation',
        ]);

        return response()->json(['data' => $this->conversationData($conversation)], 201);
    }

    public function show(Request $request, Organization $organization, AssistantConversation $conversation)
    {
        $this->access->conversation($request->user(), $organization, $conversation);

        return response()->json(['data' => [
            ...$this->conversationData($conversation),
            'runs' => $conversation->runs()->oldest()->get()->map(fn ($run) => $this->runData($run)),
            'sources' => $conversation->sources()->oldest()->get()->map(fn ($source) => $source->only(['id', 'name', 'mime', 'size', 'pages'])),
            'proposals' => $conversation->proposals()->oldest()->get()->map(fn ($proposal) => $this->proposalData($proposal)),
            'onboarding_state' => $conversation->onboarding_state,
            'cursor' => (int) DB::table('assistant_events')->where('conversation_id', $conversation->id)->max('id'),
        ]]);
    }

    public function events(Request $request, Organization $organization, AssistantConversation $conversation)
    {
        $this->access->conversation($request->user(), $organization, $conversation);
        app(AssistantRecovery::class)->recover($conversation);
        $values = $request->validate(['after' => ['sometimes', 'integer', 'min:0']]);
        $events = DB::table('assistant_events')->where('conversation_id', $conversation->id)->where('id', '>', $values['after'] ?? 0)->orderBy('id')->limit(250)->get()->map(fn ($event) => [
            'id' => $event->id, 'run_id' => $event->run_id, 'type' => $event->type, 'payload' => json_decode($event->payload, true),
        ]);

        return response()->json(['data' => ['events' => $events, 'active' => $conversation->runs()->whereIn('status', ['queued', 'running'])->exists()]]);
    }

    public function message(Request $request, Organization $organization, AssistantConversation $conversation)
    {
        $this->access->conversation($request->user(), $organization, $conversation);
        $values = $request->validate([
            'request_id' => ['required', 'uuid'], 'text' => ['required', 'string', 'max:8000'],
            'source_ids' => ['sometimes', 'array', 'max:5'], 'source_ids.*' => ['uuid', 'distinct'],
            'answers' => ['sometimes', 'array', 'max:3'],
            'answers.*.id' => ['required', 'string', 'max:80'], 'answers.*.answer' => ['required', 'string', 'max:1000'],
        ]);
        $sources = $conversation->sources()->whereIn('id', $values['source_ids'] ?? [])->get();
        abort_unless($sources->count() === count($values['source_ids'] ?? []), 422, 'A selected source is unavailable.');
        abort_if($sources->sum('size') > config('assistant.max_message_bytes'), 422, 'Choose attachments totaling at most 25 MiB.');
        $decisions = [];
        foreach (app(AssistantRecovery::class)->pending($conversation) as $approval) {
            $decisions[$approval['id']] = ['action' => 'reject', 'reason' => 'The user requests changes instead of approving: '.$values['text']];
        }
        $run = $this->queueRun($conversation, $values['request_id'], $values['text'], $values['source_ids'] ?? [], $decisions, $values['answers'] ?? []);

        return response()->json(['data' => $this->runData($run)], 202);
    }

    public function preview(Request $request, Organization $organization, AssistantConversation $conversation)
    {
        $this->access->conversation($request->user(), $organization, $conversation);
        abort_if($conversation->runs()->whereIn('status', ['queued', 'running'])->exists(), 409, 'Wait for the current response before editing its proposal.');
        $proposal = $this->proposals->preview($conversation, $request->all());

        return response()->json(['data' => $this->proposalData($proposal->fresh())], 201);
    }

    public function decide(Request $request, Organization $organization, AssistantConversation $conversation, AssistantProposal $proposal)
    {
        $this->access->conversation($request->user(), $organization, $conversation);
        abort_unless($proposal->conversation_id === $conversation->id, 404);
        $values = $request->validate(['decision' => ['required', 'in:approve,reject'], 'content_hash' => ['required', 'string', 'size:64'], 'request_id' => ['required', 'uuid']]);
        abort_unless(hash_equals($proposal->content_hash, $values['content_hash']), 409, 'Review the latest proposal.');
        $result = DB::transaction(function () use ($conversation, $proposal, $values): ?array {
            AssistantConversation::query()->whereKey($conversation->id)->lockForUpdate()->firstOrFail();
            $proposal = $proposal->fresh();
            if ($proposal->status === 'applied' && $values['decision'] === 'approve') {
                return $proposal->result;
            }
            if ($proposal->status === 'dismissed' && $values['decision'] === 'reject') {
                return null;
            }
            abort_if($conversation->runs()->whereIn('status', ['queued', 'running'])->exists(), 409, 'Wait for the current response before deciding.');
            abort_unless($proposal->status === 'pending', 409, 'This proposal is no longer available.');
            if ($values['decision'] === 'reject') {
                $proposal->update(['status' => 'dismissed']);

                return null;
            }
            $proposal->update(['status' => 'approved']);

            return $this->proposals->apply($proposal, $values['content_hash']);
        });
        $decisions = [];
        foreach (app(AssistantRecovery::class)->pending($conversation) as $approval) {
            $decisions[$approval['id']] = $values['decision'] === 'approve'
                ? ['action' => 'approve', 'arguments' => ['proposal_id' => $proposal->id, 'content_hash' => $proposal->content_hash]]
                : ['action' => 'reject', 'reason' => 'The user dismissed the proposal. Ask what they would like changed.'];
        }
        $run = null;
        $notice = null;
        try {
            $run = $this->queueRun($conversation->fresh(), $values['request_id'], $result ? 'I approved this section. The server saved draft '.$result['draft_revision'].'. Continue onboarding.' : 'I dismissed this proposal. Help me adjust it.', [], $decisions);
        } catch (HttpException $exception) {
            $notice = 'Your decision was recorded. Continue the conversation when the assistant is available.';
        }

        return response()->json(['data' => ['result' => $result, 'run' => $run ? $this->runData($run) : null, 'notice' => $notice]]);
    }

    public function cancel(Request $request, Organization $organization, AssistantConversation $conversation, AssistantRun $run)
    {
        $this->access->conversation($request->user(), $organization, $conversation);
        abort_unless($run->conversation_id === $conversation->id, 404);
        DB::transaction(function () use ($run): void {
            $locked = AssistantRun::query()->lockForUpdate()->findOrFail($run->id);
            if ($locked->active()) {
                $queued = $locked->status === 'queued';
                $locked->update(['status' => 'cancelled', 'finished_at' => now()]);
                if ($queued) {
                    app(AssistantBudget::class)->finish($locked, 0);
                }
            }
        });
        $run->refresh();

        return response()->json(['data' => $this->runData($run)]);
    }

    public function upload(Request $request, Organization $organization, AssistantConversation $conversation)
    {
        $this->access->conversation($request->user(), $organization, $conversation);
        $request->validate(['file' => ['required', 'file', 'max:'.config('assistant.max_file_kib')]]);
        $file = $request->file('file');
        $extension = strtolower($file->getClientOriginalExtension());
        $mime = (new \finfo(FILEINFO_MIME_TYPE))->file($file->getRealPath());
        $accepted = ['pdf' => ['application/pdf'], 'png' => ['image/png'], 'jpg' => ['image/jpeg'], 'jpeg' => ['image/jpeg'], 'webp' => ['image/webp'], 'txt' => ['text/plain'], 'md' => ['text/plain', 'text/markdown'], 'json' => ['text/plain', 'application/json'], 'csv' => ['text/plain', 'text/csv', 'application/csv']];
        if (! in_array($mime, $accepted[$extension] ?? [], true)) {
            throw ValidationException::withMessages(['file' => 'Use a PDF, PNG, JPEG, WebP, text, Markdown, JSON, or CSV file with matching content.']);
        }
        $pages = null;
        if ($extension === 'pdf') {
            $process = new Process(['pdfinfo', $file->getRealPath()]);
            $process->setTimeout(10)->run();
            if (! $process->isSuccessful() || str_contains($process->getOutput(), 'Encrypted:       yes') || ! preg_match('/^Pages:\s+(\d+)/m', $process->getOutput(), $matches)) {
                throw ValidationException::withMessages(['file' => 'This PDF cannot be read. Supply an unlocked PDF or images of the relevant pages.']);
            }
            $pages = (int) $matches[1];
            if ($pages > config('assistant.max_pdf_pages')) {
                throw ValidationException::withMessages(['file' => 'Please provide the relevant pages in a PDF of 100 pages or fewer.']);
            }
        }
        $path = $file->storeAs('assistant/'.$conversation->id, Str::uuid().'.'.$extension, 'local');
        $source = $conversation->sources()->create(['name' => mb_substr(basename($file->getClientOriginalName()), 0, 255), 'mime' => $mime, 'path' => $path, 'size' => $file->getSize(), 'sha256' => hash_file('sha256', $file->getRealPath()), 'pages' => $pages]);

        return response()->json(['data' => $source->only(['id', 'name', 'mime', 'size', 'pages'])], 201);
    }

    public function source(Request $request, Organization $organization, AssistantConversation $conversation, AssistantSource $source)
    {
        $this->access->conversation($request->user(), $organization, $conversation);
        abort_unless($source->conversation_id === $conversation->id, 404);

        return Storage::disk('local')->download($source->path, $source->name, ['X-Content-Type-Options' => 'nosniff']);
    }

    public function destroy(Request $request, Organization $organization, AssistantConversation $conversation)
    {
        $this->access->conversation($request->user(), $organization, $conversation);
        app(AssistantRecovery::class)->recover($conversation);
        abort_if($conversation->runs()->where('reserved_usd', '>', 0)->exists(), 409, 'Wait until the worker has stopped before deleting this conversation.');
        DB::transaction(function () use ($conversation): void {
            if ($conversation->sdk_conversation_id) {
                DB::table('agent_conversation_messages')->where('conversation_id', $conversation->sdk_conversation_id)->delete();
                DB::table('agent_conversations')->where('id', $conversation->sdk_conversation_id)->delete();
            }
            $conversation->delete();
        });
        Storage::disk('local')->deleteDirectory('assistant/'.$conversation->id);

        return response()->noContent();
    }

    private function queueRun(AssistantConversation $conversation, string $requestId, string $prompt, array $sources = [], array $decisions = [], array $answers = []): AssistantRun
    {
        return DB::transaction(function () use ($conversation, $requestId, $prompt, $sources, $decisions, $answers): AssistantRun {
            $locked = AssistantConversation::query()->lockForUpdate()->findOrFail($conversation->id);
            $existing = $locked->runs()->where('request_id', $requestId)->first();
            if ($existing) {
                return $existing;
            }
            abort_unless(config('assistant.enabled') && filled(config('ai.providers.openai.key')), 503, 'The assistant is not configured on this server. You can continue editing profiles manually.');
            app(AssistantRecovery::class)->recover();
            abort_if($locked->runs()->where('reserved_usd', '>', 0)->exists(), 409, 'This conversation already has an active response or is stopping.');
            $reserved = app(AssistantBudget::class)->reserve();
            $state = $locked->onboarding_state ?? [];
            if ($answers !== []) {
                $state['answers'] = [...($state['answers'] ?? []), ...$answers];
            }
            $state['questions'] = [];
            $locked->update(['onboarding_state' => $state]);
            $run = $locked->runs()->create(['request_id' => $requestId, 'prompt' => $prompt, 'source_ids' => $sources, 'decisions' => $decisions ?: null, 'reserved_usd' => $reserved]);
            app(AssistantEvents::class)->emit($locked, $run, 'status', ['status' => 'queued']);
            RunAssistant::dispatch($run->id)->afterCommit();

            return $run;
        });
    }

    private function conversationData(AssistantConversation $conversation): array
    {
        return ['id' => $conversation->id, 'title' => $conversation->title, 'profile_uuid' => $conversation->profile?->uuid, 'profile_name' => $conversation->profile?->name, 'updated_at' => $conversation->updated_at?->toIso8601String()];
    }

    private function runData(AssistantRun $run): array
    {
        return $run->only(['id', 'request_id', 'status', 'prompt', 'answer', 'source_ids', 'usage', 'cost_usd', 'error_code', 'error_message', 'created_at']);
    }

    private function proposalData(AssistantProposal $proposal): array
    {
        return $proposal->only(['id', 'section', 'summary', 'status', 'draft_revision', 'content_hash', 'changes', 'before', 'evidence', 'diagnostics', 'result', 'created_at']);
    }
}
