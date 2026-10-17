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
use App\Domain\Assistant\Services\AssistantProvider;
use App\Domain\Assistant\Services\AssistantRecovery;
use App\Domain\Assistant\Services\ExecutionEvidence;
use App\Domain\Assistant\Services\ProfileKnowledge;
use App\Domain\Assistant\Services\ProfileProposalService;
use App\Domain\Assistant\Services\WorkflowDraftContext;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Automation\Services\DagAuthoring;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Help\Services\HelpAccess;
use App\Domain\Help\Services\HelpAnswers;
use App\Domain\Help\Services\HelpCatalog;
use App\Domain\Help\Services\HelpRetrieval;
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
        $scope = $request->validate(['scope' => 'sometimes|in:profile,automation,help,adapter'])['scope'] ?? 'profile';
        if ($scope === 'help') {
            app(HelpAccess::class)->organization($request->user(), $organization);

            return response()->json(['data' => ['enabled' => app(AssistantProvider::class)->configured() && (bool) config('assistant.help_enabled'), 'provider' => $this->provider()]]);
        }
        if ($scope === 'adapter') {
            abort_unless(config('adapters.enabled'), 404);
            app(DeviceAuthorization::class)->authorize($request->user(), DevicePermission::MANAGE, $organization);
            // The adapter workspace lists only its own conversations; without the filter the tab could reopen another adapter's thread.
            $adapterUuid = $request->validate(['adapter_uuid' => 'sometimes|string|max:64'])['adapter_uuid'] ?? null;

            return response()->json(['data' => str_ends_with($request->path(), 'settings') ? ['enabled' => app(AssistantProvider::class)->configured(), 'provider' => $this->provider()] : AssistantConversation::where('scope', 'adapter')->where('organization_id', $organization->id)->where('user_id', $request->user()->id)->when($adapterUuid, fn ($query) => $query->whereHas('adapter', fn ($adapter) => $adapter->where('uuid', $adapterUuid)))->latest('updated_at')->limit(100)->get()->map(fn ($conversation) => $this->conversationData($conversation))]);
        }
        if ($request->query('scope') === 'automation') {
            $this->access->automation($request->user(), $organization);

            return response()->json(['data' => ['enabled' => app(AssistantProvider::class)->configured(), 'provider' => $this->provider()]]);
        }
        $this->access->organization($request->user(), $organization);

        return response()->json(['data' => [
            'enabled' => app(AssistantProvider::class)->configured(),
            'provider' => $this->provider(),
            'capabilities' => $this->access->capabilities($request->user(), $organization),
            'schema' => app(ProfileKnowledge::class)->describe(),
            'supported_extensions' => ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'md', 'json', 'csv'],
            'max_file_bytes' => config('assistant.max_file_kib') * 1024,
        ]]);
    }

    public function index(Request $request, Organization $organization)
    {
        $scope = $request->validate(['scope' => 'sometimes|in:profile,automation,help,adapter'])['scope'] ?? 'profile';
        if ($scope === 'help') {
            app(HelpAccess::class)->organization($request->user(), $organization);
            $conversations = AssistantConversation::where('scope', 'help')->where('organization_id', $organization->id)->where('user_id', $request->user()->id)->latest('updated_at')->limit(100)->get();

            return response()->json(['data' => $conversations->map(fn ($conversation) => $this->conversationData($conversation))]);
        }
        if ($scope === 'adapter') {
            abort_unless(config('adapters.enabled'), 404);
            app(DeviceAuthorization::class)->authorize($request->user(), DevicePermission::MANAGE, $organization);
            // The adapter workspace lists only its own conversations; without the filter the tab could reopen another adapter's thread.
            $adapterUuid = $request->validate(['adapter_uuid' => 'sometimes|string|max:64'])['adapter_uuid'] ?? null;

            return response()->json(['data' => str_ends_with($request->path(), 'settings') ? ['enabled' => app(AssistantProvider::class)->configured(), 'provider' => $this->provider()] : AssistantConversation::where('scope', 'adapter')->where('organization_id', $organization->id)->where('user_id', $request->user()->id)->when($adapterUuid, fn ($query) => $query->whereHas('adapter', fn ($adapter) => $adapter->where('uuid', $adapterUuid)))->latest('updated_at')->limit(100)->get()->map(fn ($conversation) => $this->conversationData($conversation))]);
        }
        if ($request->query('scope') === 'automation') {
            $this->access->automation($request->user(), $organization);
            $conversations = AssistantConversation::where('scope', 'automation')->where('organization_id', $organization->id)->where('user_id', $request->user()->id)->with('workflow')->latest('updated_at')->limit(100)->get();

            return response()->json(['data' => $conversations->map(fn ($conversation) => $this->conversationData($conversation))]);
        }
        $this->access->organization($request->user(), $organization);
        $conversations = AssistantConversation::query()->where('scope', 'profile')->where('organization_id', $organization->id)->where('user_id', $request->user()->id)->with('profile')->orderByDesc('updated_at')->limit(100)->get();

        return response()->json(['data' => $conversations->map(fn ($conversation) => $this->conversationData($conversation))]);
    }

    public function store(Request $request, Organization $organization)
    {
        $scope = $request->validate(['scope' => 'sometimes|in:profile,automation,help,adapter'])['scope'] ?? 'profile';
        if ($scope === 'help') {
            app(HelpAccess::class)->organization($request->user(), $organization);
            $values = $request->validate(['title' => 'nullable|string|max:255', 'profile_uuid' => 'prohibited', 'workflow_uuid' => 'prohibited']);
            $conversation = AssistantConversation::create(['scope' => 'help', 'organization_id' => $organization->id, 'user_id' => $request->user()->id, 'title' => $values['title'] ?? 'Help conversation']);

            return response()->json(['data' => $this->conversationData($conversation)], 201);
        }
        if ($scope === 'adapter') {
            abort_unless(config('adapters.enabled'), 404);
            $values = $request->validate(['adapter_uuid' => 'required|uuid', 'title' => 'nullable|string|max:255']);
            $adapter = DeviceAdapter::where('organization_id', $organization->id)->where('uuid', $values['adapter_uuid'])->firstOrFail();
            app(DeviceAuthorization::class)->authorize($request->user(), DevicePermission::MANAGE, $organization, $adapter);
            $conversation = AssistantConversation::create(['scope' => 'adapter', 'organization_id' => $organization->id, 'user_id' => $request->user()->id, 'device_adapter_id' => $adapter->id, 'title' => $values['title'] ?? $adapter->name]);

            return response()->json(['data' => $this->conversationData($conversation)], 201);
        }
        if ($request->input('scope') === 'automation') {
            $this->access->automation($request->user(), $organization);
            $values = $request->validate(['workflow_uuid' => 'nullable|uuid', 'title' => 'nullable|string|max:255']);
            $workflow = isset($values['workflow_uuid']) ? Workflow::where('organization_id', $organization->id)->where('uuid', $values['workflow_uuid'])->firstOrFail() : null;
            $conversation = AssistantConversation::create([
                'scope' => 'automation', 'organization_id' => $organization->id, 'user_id' => $request->user()->id,
                'automation_workflow_id' => $workflow?->id, 'title' => $values['title'] ?? $workflow?->name ?? 'New automation conversation',
            ]);

            return response()->json(['data' => $this->conversationData($conversation)], 201);
        }
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
        if ($conversation->scope === 'help') {
            $values = $request->validate([
                'request_id' => 'required|uuid', 'text' => 'required|string|max:8000', 'page_context' => 'required|string|max:80',
                'source_ids' => 'prohibited', 'answers' => 'prohibited', 'target' => 'prohibited', 'execution_id' => 'prohibited',
            ]);
            app(HelpRetrieval::class)->page($request->user(), $organization, $values['page_context']);
            $run = $this->queueRun($conversation, $values['request_id'], $values['text'], pageContext: $values['page_context']);

            return response()->json(['data' => $this->runData($run)], 202);
        }
        $values = $request->validate([
            'request_id' => ['required', 'uuid'], 'text' => ['required', 'string', 'max:8000'],
            'source_ids' => ['sometimes', 'array', 'max:5'], 'source_ids.*' => ['uuid', 'distinct'],
            'execution_id' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:9223372036854775807'],
            'answers' => ['sometimes', 'array', 'max:3'],
            'answers.*.id' => ['required', 'string', 'max:80'], 'answers.*.answer' => ['required', 'string', 'max:1000'],
        ]);
        abort_if(isset($values['execution_id']) && $conversation->scope !== 'automation', 422, 'Execution evidence requires an automation conversation.');
        $sources = $conversation->sources()->whereIn('id', $values['source_ids'] ?? [])->get();
        abort_unless($sources->count() === count($values['source_ids'] ?? []), 422, 'A selected source is unavailable.');
        abort_if($sources->sum('size') > config('assistant.max_message_bytes'), 422, 'Choose attachments totaling at most 25 MiB.');
        $decisions = [];
        foreach (app(AssistantRecovery::class)->pending($conversation) as $approval) {
            $decisions[$approval['id']] = ['action' => 'reject', 'reason' => 'The user requests changes instead of approving: '.$values['text']];
        }
        $target = null;
        if ($conversation->scope === 'automation') {
            $target = $request->validate([
                'target' => 'required|array:name,workflow,draft_revision', 'target.name' => 'required|string|max:255',
                'target.draft_revision' => 'nullable|integer|min:1',
                'target.workflow' => 'required|array:schema_version,uuid,version_uuid,organization_uuid,bindings,nodes,edges',
                'target.workflow.schema_version' => 'required|in:automation-workflow.v2',
                'target.workflow.nodes' => 'present|array|max:100', 'target.workflow.edges' => 'present|array|max:200',
                'target.workflow.bindings' => 'present|array|max:32', 'target.workflow.bindings.*.device_uuid' => 'required|uuid',
            ])['target'];
            // The stored draft may be as large as the compiler accepts; the model sees geofence geometry by reference.
            abort_if(strlen(json_encode($target['workflow'], JSON_THROW_ON_ERROR)) > DagAuthoring::MAX_WORKFLOW_BYTES, 422, 'This draft is too large to save as a workflow.');
            abort_if(strlen(json_encode(app(WorkflowDraftContext::class)->prompt($target), JSON_THROW_ON_ERROR)) > config('assistant.max_draft_characters'), 422, 'This draft is too large for the assistant. Edit it manually.');
            foreach ($target['workflow']['bindings'] as $binding) {
                $role = is_string($binding['role'] ?? null) ? $binding['role'] : 'a binding';
                abort_unless(Device::where('organization_id', $organization->id)->where('uuid', $binding['device_uuid'])->exists(), 422, "The device for {$role} is no longer available. Rebind or remove it in the editor, then ask again.");
            }
            abort_if(! empty($values['source_ids']), 422, 'Automation conversations use the current draft and authorized resources.');
        }
        $run = $this->queueRun($conversation, $values['request_id'], $values['text'], $values['source_ids'] ?? [], $decisions, $values['answers'] ?? [], $target, isset($values['execution_id']) ? (string) $values['execution_id'] : null);

        return response()->json(['data' => $this->runData($run)], 202);
    }

    public function preview(Request $request, Organization $organization, AssistantConversation $conversation)
    {
        $this->access->conversation($request->user(), $organization, $conversation);
        abort_unless($conversation->scope === 'profile', 422);
        abort_if($conversation->runs()->whereIn('status', ['queued', 'running'])->exists(), 409, 'Wait for the current response before editing its proposal.');
        $proposal = $this->proposals->preview($conversation, $request->all());

        return response()->json(['data' => $this->proposalData($proposal->fresh())], 201);
    }

    public function decide(Request $request, Organization $organization, AssistantConversation $conversation, AssistantProposal $proposal)
    {
        $this->access->conversation($request->user(), $organization, $conversation);
        abort_unless($conversation->scope === 'profile', 422, 'Use the proposal in the automation editor, then save and review activation separately.');
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
        abort_unless($conversation->scope === 'profile', 422);
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
        abort_unless($conversation->scope === 'profile', 422);
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

    /**
     * The provider replies come from, so the portal can say where content is sent.
     *
     * @return array{id: string, label: string}
     */
    private function provider(): array
    {
        $provider = app(AssistantProvider::class);

        return ['id' => $provider->provider(), 'label' => $provider->label()];
    }

    private function queueRun(AssistantConversation $conversation, string $requestId, string $prompt, array $sources = [], array $decisions = [], array $answers = [], ?array $target = null, ?string $evaluationId = null, ?string $pageContext = null): AssistantRun
    {
        return DB::transaction(function () use ($conversation, $requestId, $prompt, $sources, $decisions, $answers, $target, $evaluationId, $pageContext): AssistantRun {
            $locked = AssistantConversation::query()->lockForUpdate()->findOrFail($conversation->id);
            $existing = $locked->runs()->where('request_id', $requestId)->first();
            if ($existing) {
                return $existing;
            }
            abort_unless(app(AssistantProvider::class)->configured(), 503, 'The assistant is not configured on this server. You can continue editing manually.');
            if ($locked->scope === 'help') {
                abort_unless(config('assistant.help_enabled'), 503, 'Ask Help is unavailable. You can continue reading the guides.');
            }
            app(AssistantRecovery::class)->recover();
            abort_if($locked->runs()->where('reserved_usd', '>', 0)->exists(), 409, 'This conversation already has an active response or is stopping.');
            $reserved = app(AssistantBudget::class)->reserve();
            $state = $locked->onboarding_state ?? [];
            if ($target !== null) {
                $targetUuid = $target['workflow']['uuid'] ?? null;
                if ($targetUuid) {
                    $workflow = Workflow::where('organization_id', $locked->organization_id)->where('uuid', $targetUuid)->firstOrFail();
                    abort_if($locked->automation_workflow_id !== null && $locked->automation_workflow_id !== $workflow->id, 409, 'Start a new conversation for a different workflow.');
                    $locked->automation_workflow_id = $workflow->id;
                }
                $state['target'] = $target;
                $locked->proposals()->where('status', 'pending')->update(['status' => 'superseded']);
            }
            if ($answers !== []) {
                $state['answers'] = [...($state['answers'] ?? []), ...$answers];
            }
            $state['questions'] = [];
            $locked->update(['onboarding_state' => $state]);
            $evidence = $evaluationId !== null ? app(ExecutionEvidence::class)->capture($locked, $evaluationId) : null;
            $helpPage = $pageContext !== null ? app(HelpCatalog::class)->context($pageContext) : null;
            $run = $locked->runs()->create(['help_context' => $helpPage ? ['key' => $pageContext, 'title' => $helpPage['title']] : null, 'execution_context' => $evidence, 'request_id' => $requestId, 'prompt' => $prompt, 'source_ids' => $sources, 'decisions' => $decisions ?: null, 'reserved_usd' => $reserved]);
            app(AssistantEvents::class)->emit($locked, $run, 'status', ['status' => 'queued']);
            RunAssistant::dispatch($run->id)->afterCommit();

            return $run;
        });
    }

    private function conversationData(AssistantConversation $conversation): array
    {
        return ['adapter_uuid' => $conversation->adapter?->uuid, 'id' => $conversation->id, 'title' => $conversation->title, 'scope' => $conversation->scope, 'workflow_uuid' => $conversation->workflow?->uuid, 'profile_uuid' => $conversation->profile?->uuid, 'profile_name' => $conversation->profile?->name, 'updated_at' => $conversation->updated_at?->toIso8601String()];
    }

    private function runData(AssistantRun $run): array
    {
        return [...$run->only(['id', 'request_id', 'status', 'prompt', 'answer', 'source_ids', 'usage', 'cost_usd', 'error_code', 'error_message', 'created_at']), 'execution' => app(ExecutionEvidence::class)->references($run->execution_context), ...($run->conversation->scope === 'help' ? app(HelpAnswers::class)->visible($run) : [])];
    }

    private function proposalData(AssistantProposal $proposal): array
    {
        return $proposal->only(['id', 'section', 'summary', 'status', 'draft_revision', 'content_hash', 'changes', 'before', 'evidence', 'diagnostics', 'result', 'created_at']);
    }
}
