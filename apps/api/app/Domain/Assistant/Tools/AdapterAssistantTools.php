<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Tools;

use App\Domain\Assistant\Models\AssistantRun;
use App\Domain\Assistant\Services\AssistantAccess;
use App\Domain\Assistant\Services\AssistantEvents;
use App\Domain\DeviceAdapters\Models\AdapterProposal;
use App\Domain\DeviceAdapters\Services\AdapterManager;
use App\Domain\DeviceProfiles\Support\CanonicalJson;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Laravel\Ai\Contracts\Tool;
use Laravel\Ai\Tools\Request;
use Stringable;

final class AdapterAssistantTools implements Tool
{
    public function __construct(private readonly AssistantRun $run) {}

    public function description(): string
    {
        return 'Adapter draft tools: read_source {source_id:uuid} reads an authorized selected document; test_decoder {code:string} tests against saved fixtures; propose_decoder {code:string,summary:string,evidence:[{origin:source|user_confirmed|suggested|unresolved,source_id?:uuid,location?:string,note?:string}]} creates an immutable review proposal. No tool edits or deploys the running adapter.';
    }

    public function schema(JsonSchema $schema): array
    {
        return ['action' => $schema->string()->enum(['read_source', 'test_decoder', 'propose_decoder'])->required(), 'arguments_json' => $schema->string()->required()];
    }

    public function handle(Request $request): Stringable|string
    {
        try {
            $run = $this->run->fresh();
            abort_unless($run?->status === 'running', 409);
            $conversation = $run->conversation;
            app(AssistantAccess::class)->conversation($conversation->user, $conversation->organization, $conversation);
            abort_unless($conversation->scope === 'adapter', 422);
            abort_if(strlen($request['arguments_json']) > 128000, 422);
            $args = json_decode($request['arguments_json'], true, 32, JSON_THROW_ON_ERROR);
            $adapter = $conversation->adapter;
            if ($request['action'] === 'read_source') {
                $source = $conversation->sources()->whereKey($args['source_id'] ?? '')->firstOrFail();
                abort_unless(in_array($source->id, $run->source_ids ?? [], true), 422, 'Select this source in the current message.');
                $result = $source->only(['id', 'name', 'mime', 'pages']);
                $result['text'] = str_starts_with($source->mime, 'text/') || $source->mime === 'application/json' ? mb_substr(Storage::disk('local')->get($source->path), 0, 16000) : 'Inspect the selected image or PDF attachment supplied with this turn.';
            } else {
                $v = Validator::make($args, ['code' => 'required|string|max:64000', 'summary' => 'required_if:action,propose_decoder|nullable|string|max:1000', 'evidence' => 'sometimes|array|max:20', 'evidence.*.origin' => 'required|in:source,user_confirmed,suggested,unresolved', 'evidence.*.source_id' => 'nullable|uuid', 'evidence.*.location' => 'nullable|string|max:200', 'evidence.*.note' => 'nullable|string|max:1000'])->validate();
                if ($request['action'] === 'test_decoder') {
                    $result = app(AdapterManager::class)->request('/test', ['code' => $v['code'], 'fixtures' => $adapter->fixtures, 'profile' => $adapter->artifact->definition]);
                } else {
                    abort_unless(filled($v['summary'] ?? null), 422, 'A proposal summary is required.');
                    $evidence = $v['evidence'] ?? [['origin' => 'suggested', 'note' => 'Review against the manufacturer documentation and sample payload.']];
                    foreach ($evidence as $entry) {
                        if (isset($entry['source_id'])) {
                            abort_unless($conversation->sources()->whereKey($entry['source_id'])->exists(), 422, 'The cited source is unavailable.');
                        }
                    }
                    $content = ['draft_revision' => $adapter->draft_revision, 'code' => $v['code'], 'summary' => $v['summary'], 'evidence' => $evidence];
                    $proposal = AdapterProposal::create([...$content, 'device_adapter_id' => $adapter->id, 'conversation_id' => $conversation->id, 'user_id' => $conversation->user_id, 'content_hash' => hash('sha256', app(CanonicalJson::class)->encode($content))]);
                    app(AssistantEvents::class)->emit($conversation, $run, 'adapter_proposal', $proposal->only(['uuid', 'summary', 'content_hash', 'draft_revision']));
                    $result = $proposal->only(['uuid', 'summary', 'content_hash', 'draft_revision', 'status']);
                }
            }
            $encoded = json_encode($result, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);

            return strlen($encoded) > config('assistant.max_context_characters') ? json_encode(['error' => 'Result too large; use a smaller source or fixture.']) : $encoded;
        } catch (\Throwable) {
            return json_encode(['error' => 'The adapter draft operation did not complete. Check source access, decoder tests and the current draft revision.']);
        }
    }
}
