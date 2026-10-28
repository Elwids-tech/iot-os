<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Tools;

use App\Domain\Assistant\Models\AssistantRun;
use App\Domain\Assistant\Services\AssistantAccess;
use App\Domain\Assistant\Services\AssistantEvents;
use App\Domain\Assistant\Services\AssistantQuestions;
use App\Domain\Assistant\Services\OnboardingProposals;
use App\Domain\DeviceAdapters\Models\AdapterDelivery;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\DeviceAdapters\Models\DeviceInstallation;
use App\Domain\DeviceAdapters\Services\AdapterDiagnostics;
use App\Domain\DeviceAdapters\Services\AdapterManager;
use App\Domain\DeviceAdapters\Services\PollingService;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Laravel\Ai\Contracts\Tool;
use Laravel\Ai\Tools\Request;
use Stringable;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Throwable;

/**
 * The device onboarding assistant's tools (spec 020, FR-102 to FR-108). Every action
 * re-checks the run, the conversation and the person's permissions. Nothing here
 * saves an adapter, enters a credential, deploys or activates: changes are proposals a
 * person applies, and Fetch now only reads the vendor API.
 */
final class OnboardingTools implements Tool
{
    public function __construct(private readonly AssistantRun $run) {}

    public function description(): Stringable|string
    {
        return 'Device onboarding tools. Actions: find {kind: adapters|profiles, query?}; ask_questions {questions: [{id, prompt, required, options}]} (1-3); recommend_path {path: direct|gateway|adapter, source_type?: platform|vendor|webhook|poll, reason}; '
            .'propose_adapter {mode: reuse, adapter_uuid, summary} to continue on an existing ADAPTER from find adapters, or {mode: create, name, artifact_uuid, source, summary} to create a new adapter for a published profile (artifact_uuid from find profiles; source holds non-secret settings such as {type: poll, request: {method, url, query}, credentials: {placement, name}, records, cursor}); status {}; samples {limit?}; fetch_now {}; test_decoder {code, inputs?: fixtures|samples}; '
            .'propose_change {summary, evidence, code?, source?, fixtures?}; next_step {step: credentials|secret|test|deploy|activate|cursor, message}; read_source {source_id}. '
            .'status, samples, fetch_now, test_decoder, propose_change and next_step need the conversation to be bound to an adapter (after a reuse or create proposal is applied). No action reveals credentials or secrets.';
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'action' => $schema->string()->enum(['find', 'ask_questions', 'recommend_path', 'propose_adapter', 'status', 'samples', 'fetch_now', 'test_decoder', 'propose_change', 'next_step', 'read_source'])->required(),
            'arguments_json' => $schema->string()->description('A JSON object with the action arguments. Use {} when there are none.')->required(),
        ];
    }

    public function handle(Request $request): Stringable|string
    {
        try {
            $run = $this->run->fresh();
            abort_unless($run !== null && $run->status === 'running', 409, 'This assistant run is no longer active.');
            $conversation = $run->conversation;
            app(AssistantAccess::class)->conversation($conversation->user, $conversation->organization, $conversation);
            abort_unless($conversation->scope === 'onboarding', 422);
            abort_if(strlen($request['arguments_json']) > 128000, 422, 'Arguments are too large.');
            $args = json_decode($request['arguments_json'], true, 64, JSON_THROW_ON_ERROR);
            abort_unless(is_array($args), 422, 'Arguments must be an object.');
            $result = match ($request['action']) {
                'find' => $this->find($args),
                'ask_questions' => app(AssistantQuestions::class)->ask($run, $args),
                'recommend_path' => $this->recommend($run, $args),
                'propose_adapter' => $this->proposeAdapter($run, $args),
                'status' => $this->status(),
                'samples' => $this->samples((int) ($args['limit'] ?? 5)),
                'fetch_now' => $this->fetch($run),
                'test_decoder' => $this->test($args),
                'propose_change' => $this->proposeChange($run, $args),
                'next_step' => $this->nextStep($run, $args),
                'read_source' => $this->source((string) ($args['source_id'] ?? '')),
            };
            $encoded = json_encode($result, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);

            return strlen($encoded) > config('assistant.max_context_characters') ? json_encode(['error' => 'The result is too large. Ask for fewer samples or a smaller page.']) : $encoded;
        } catch (Throwable $exception) {
            $reason = match (true) {
                $exception instanceof ModelNotFoundException => 'Nothing with that uuid exists here. Use uuids exactly as find returned them: adapter_uuid for an existing adapter (mode reuse), artifact_uuid of a published profile (mode create).',
                $exception instanceof HttpExceptionInterface => $exception->getMessage(),
                default => null,
            };

            return json_encode(['error' => 'The onboarding action did not complete.', 'reason' => $reason,
                'details' => $exception instanceof ValidationException ? $exception->errors() : []], JSON_THROW_ON_ERROR);
        }
    }

    private function conversation()
    {
        return $this->run->fresh()->conversation;
    }

    private function adapter(): DeviceAdapter
    {
        $adapter = $this->conversation()->adapter;
        abort_unless($adapter, 422, 'No adapter is chosen yet. Propose reusing or creating one first.');

        return $adapter;
    }

    private function find(array $args): array
    {
        $conversation = $this->conversation();
        $v = Validator::make($args, ['kind' => 'required|in:adapters,profiles', 'query' => 'nullable|string|max:200'])->validate();
        // Models search with several keywords; any word may match and more matches rank higher.
        $words = collect(preg_split('/[^\pL\pN]+/u', mb_strtolower((string) ($v['query'] ?? ''))))->filter(fn ($w) => mb_strlen($w) >= 3)->unique()->take(12)->values();
        $matching = fn ($query) => $words->isEmpty() ? $query : $query->where(fn ($q) => $words->each(fn ($w) => $q->orWhereRaw('lower(name) like ?', ['%'.addcslashes($w, '%_').'%'])));
        $score = fn (string $name) => $words->filter(fn ($w) => str_contains(mb_strtolower($name), $w))->count();
        if ($v['kind'] === 'adapters') {
            return ['adapters' => $matching(DeviceAdapter::where('organization_id', $conversation->organization_id))->latest()->limit(50)->get()->sortByDesc(fn ($a) => $score($a->name))->take(20)
                ->map(fn (DeviceAdapter $a) => ['uuid' => $a->uuid, 'name' => $a->name, 'source_type' => $a->source['type'] ?? null, 'profile' => $a->artifact->profile->name, 'status' => $a->status,
                    'devices' => DeviceInstallation::whereIn('device_adapter_candidate_id', $a->candidates()->select('id'))->whereNull('ended_at')->count()])->values()->all()];
        }
        $profiles = DeviceProfileArtifact::whereHas('profile', fn ($q) => $matching($q->where('organization_id', $conversation->organization_id)))->latest('revision')->limit(100)->get()
            ->unique(fn ($artifact) => $artifact->device_profile_id)->sortByDesc(fn ($artifact) => $score($artifact->profile->name))->take(20);

        return ['profiles' => $profiles->map(fn ($artifact) => ['uuid' => $artifact->profile->uuid, 'artifact_uuid' => $artifact->uuid, 'name' => $artifact->profile->name, 'revision' => $artifact->revision,
            'parameters' => collect($artifact->definition['parameters'] ?? [])->filter(fn ($p) => ($p['reports_state'] ?? false) && ($p['kind'] ?? null) !== 'derived')->take(60)->map(fn ($p) => ['key' => $p['key'], 'data_type' => $p['data_type'], 'unit' => $p['unit'] ?? null])->values()->all()])->values()->all(),
            'note' => 'Only published profiles are listed. To create an adapter for one, call propose_adapter with mode create and its artifact_uuid.'];
    }

    private function recommend(AssistantRun $run, array $args): array
    {
        $v = Validator::make($args, ['path' => 'required|in:direct,gateway,adapter', 'source_type' => 'nullable|required_if:path,adapter|in:platform,vendor,webhook,poll', 'reason' => 'required|string|max:600'])->validate();
        $conversation = $run->conversation;
        $conversation->update(['onboarding_state' => [...($conversation->fresh()->onboarding_state ?? []), 'path' => $v['path'], 'source_type' => $v['source_type'] ?? null]]);
        app(AssistantEvents::class)->emit($conversation, $run, 'onboarding_path', $v);

        return ['shown' => true, ...$v, 'next' => $v['path'] === 'adapter' ? 'Find or propose the adapter.' : 'The person continues in the Add device form; nothing else is needed from you.'];
    }

    private function proposeAdapter(AssistantRun $run, array $args): array
    {
        $conversation = $run->conversation;
        $proposals = app(OnboardingProposals::class);
        $args['evidence'] = $this->evidence($args['evidence'] ?? null);
        $v = Validator::make($args, ['mode' => 'required|in:reuse,create', 'summary' => 'required|string|max:1000', 'adapter_uuid' => 'required_if:mode,reuse|nullable|uuid', 'name' => 'required_if:mode,create|nullable|string|max:255',
            'artifact_uuid' => 'required_if:mode,create|nullable|uuid', 'source' => 'required_if:mode,create|nullable|array', 'fixtures' => 'sometimes|array|max:10', 'code' => 'nullable|string|max:64000',
            'evidence' => 'sometimes|array|max:20'])->validate();
        if ($v['mode'] === 'reuse') {
            $adapter = DeviceAdapter::where('organization_id', $conversation->organization_id)->where('uuid', $v['adapter_uuid'])->firstOrFail();
            app(DeviceAuthorization::class)->authorize($conversation->user, DevicePermission::MANAGE, $conversation->organization, $adapter);
            $proposal = $proposals->propose($run, ['kind' => 'reuse', 'device_adapter_id' => $adapter->id, 'name' => $adapter->name, 'summary' => $v['summary'], 'evidence' => $v['evidence'] ?? []]);
        } else {
            $artifact = DeviceProfileArtifact::where('uuid', $v['artifact_uuid'])->whereHas('profile', fn ($q) => $q->where('organization_id', $conversation->organization_id))->firstOrFail();
            $proposal = $proposals->propose($run, ['kind' => 'create', 'name' => $v['name'], 'artifact_uuid' => $artifact->uuid, 'source' => $proposals->source($v['source']), 'code' => $v['code'] ?? null,
                'fixtures' => isset($v['fixtures']) ? $proposals->fixtures($v['fixtures']) : null, 'summary' => $v['summary'], 'evidence' => $v['evidence'] ?? []]);
        }

        return [...$proposals->view($proposal), 'note' => 'Shown to the person for review. Nothing is created until they apply it.'];
    }

    private function status(): array
    {
        $adapter = $this->adapter();
        $current = $adapter->revisions()->where('revision', $adapter->draft_revision)->first();

        return ['adapter' => ['uuid' => $adapter->uuid, 'name' => $adapter->name, 'draft_revision' => $adapter->draft_revision, 'status' => $adapter->status, 'source_type' => $adapter->source['type'] ?? null,
            'fixtures' => count($adapter->fixtures ?? []), 'credentials_saved' => in_array($adapter->source['type'] ?? null, ['platform', 'webhook'], true) ? [] : collect($adapter->secrets ?? [])->filter(fn ($value) => filled($value))->keys()->values()->all()],
            ...app(AdapterDiagnostics::class)->summary($adapter), 'counts' => app(AdapterDiagnostics::class)->counts($adapter),
            'last_test' => $current?->test_result ? ['valid' => $current->test_result['valid'] ?? false, 'tested_at' => $current->tested_at?->toIso8601String(), 'errors' => collect($current->test_result['results'] ?? [])->pluck('error')->filter()->take(5)->values()->all()] : null,
            'discovered' => $adapter->candidates()->latest('last_seen_at')->limit(20)->get(['source_device_id', 'status', 'last_seen_at'])->toArray()];
    }

    private function samples(int $limit): array
    {
        $adapter = $this->adapter();
        $excerpt = function (?array $input) {
            if (! $input) {
                return null;
            }
            $bytes = base64_decode($input['payload_base64'] ?? '', true) ?: '';

            return [...collect($input)->except('payload_base64')->all(), 'payload_text' => mb_substr($bytes, 0, 4096), 'truncated' => strlen($bytes) > 4096 || ($input['truncated'] ?? false)];
        };

        return ['samples' => AdapterDelivery::where('device_adapter_id', $adapter->id)->whereIn('kind', ['sample', 'failed'])->latest('received_at')->limit(max(1, min($limit, 10)))->get()
            ->map(fn ($d) => ['uuid' => $d->uuid, 'kind' => $d->kind, 'received_at' => $d->received_at?->toIso8601String(), 'error' => $d->error, 'input' => $excerpt($d->input)])->all(),
            'previews' => $adapter->candidates()->latest('last_seen_at')->limit(5)->get(['source_device_id', 'preview'])->toArray(),
            'fixtures' => array_slice($adapter->fixtures ?? [], 0, 3)];
    }

    private function fetch(AssistantRun $run): array
    {
        $adapter = $this->adapter();
        $conversation = $run->conversation;
        app(DeviceAuthorization::class)->authorize($conversation->user, DevicePermission::CONNECTIONS, $conversation->organization, $adapter);
        $result = app(PollingService::class)->fetch($adapter);
        $summary = ['adapter_uuid' => $adapter->uuid, 'status' => $result['status'] ?? null, 'record_count' => $result['record_count'] ?? 0, 'next_cursor' => $result['next_cursor'] ?? null, 'error' => $result['error'] ?? null, 'at' => now()->toIso8601String()];
        $conversation->update(['onboarding_state' => [...($conversation->fresh()->onboarding_state ?? []), 'last_fetch' => $summary]]);
        app(AssistantEvents::class)->emit($conversation, $run, 'fetch_now', $summary);

        return ['status' => $result['status'] ?? null, 'duration_ms' => $result['duration_ms'] ?? null, 'error' => $result['error'] ?? null, 'record_count' => $result['record_count'] ?? 0,
            'records' => array_slice($result['records'] ?? [], 0, 3), 'next_cursor' => $result['next_cursor'] ?? null, 'more' => $result['more'] ?? false,
            'excerpt' => mb_substr((string) ($result['excerpt'] ?? ''), 0, 4096), 'note' => 'Credentials are redacted. The stored cursor did not move. Use these records as fixtures in propose_change.'];
    }

    private function test(array $args): array
    {
        $adapter = $this->adapter();
        $v = Validator::make($args, ['code' => 'required|string|max:64000', 'inputs' => 'nullable|in:fixtures,samples'])->validate();
        $fixtures = ($v['inputs'] ?? 'fixtures') === 'samples'
            ? AdapterDelivery::where('device_adapter_id', $adapter->id)->whereIn('kind', ['sample', 'failed'])->whereNotNull('input')->latest('received_at')->limit(10)->get()->pluck('input')->filter(fn ($i) => ! ($i['truncated'] ?? false))->values()->all()
            : ($adapter->fixtures ?? []);
        abort_if($fixtures === [], 422, 'There are no samples or fixtures to test against yet.');

        return app(AdapterManager::class)->request('/test', ['code' => $v['code'], 'fixtures' => array_slice($fixtures, 0, 10), 'profile' => $adapter->artifact->definition]);
    }

    private function proposeChange(AssistantRun $run, array $args): array
    {
        $adapter = $this->adapter();
        $proposals = app(OnboardingProposals::class);
        $args['evidence'] = $this->evidence($args['evidence'] ?? null);
        $v = Validator::make($args, ['summary' => 'required|string|max:1000', 'code' => 'nullable|string|max:64000', 'source' => 'nullable|array', 'fixtures' => 'nullable|array|max:10', 'evidence' => 'present|array'])->validate();
        abort_if(! isset($v['code']) && ! isset($v['source']) && ! isset($v['fixtures']), 422, 'Propose a decoder, source settings or fixtures.');
        foreach ($v['evidence'] ?? [] as $entry) {
            abort_if(isset($entry['source_id']) && ! $run->conversation->sources()->whereKey($entry['source_id'])->exists(), 422, 'The cited source is unavailable.');
        }
        $source = isset($v['source']) ? $proposals->source($v['source']) : null;
        abort_if($source && $source['type'] !== ($adapter->source['type'] ?? null), 422, 'Change the source type in the form; a proposal keeps the adapter\'s source type.');
        $proposal = $proposals->propose($run, ['kind' => 'change', 'device_adapter_id' => $adapter->id, 'draft_revision' => $adapter->draft_revision, 'code' => $v['code'] ?? null, 'source' => $source,
            'fixtures' => isset($v['fixtures']) ? $proposals->fixtures($v['fixtures']) : null, 'summary' => $v['summary'], 'evidence' => $v['evidence'] ?: [['origin' => 'suggested', 'note' => 'Review against the vendor documentation and the samples.']]]);

        return [...$proposals->view($proposal), 'note' => 'Shown to the person for review. Applying it saves a new draft revision; tests and deployment stay with them.'];
    }

    /** Evidence as the review card shows it; models send strings or loose objects. */
    private function evidence(mixed $evidence): array
    {
        return collect(is_array($evidence) ? $evidence : ($evidence ? [$evidence] : []))->take(20)->map(function ($entry) {
            if (! is_array($entry)) {
                return ['origin' => 'suggested', 'note' => mb_substr(is_scalar($entry) ? (string) $entry : json_encode($entry), 0, 1000)];
            }
            $origin = in_array($entry['origin'] ?? null, ['source', 'user_confirmed', 'suggested', 'unresolved'], true) ? $entry['origin'] : 'suggested';
            $note = $entry['note'] ?? $entry['text'] ?? $entry['description'] ?? null;

            return array_filter(['origin' => $origin, 'source_id' => is_string($entry['source_id'] ?? null) && Str::isUuid($entry['source_id']) ? $entry['source_id'] : null,
                'location' => isset($entry['location']) ? mb_substr((string) $entry['location'], 0, 200) : null, 'note' => $note !== null ? mb_substr(is_scalar($note) ? (string) $note : json_encode($note), 0, 1000) : null], fn ($value) => $value !== null);
        })->values()->all();
    }

    private function nextStep(AssistantRun $run, array $args): array
    {
        $adapter = $this->adapter();
        $v = Validator::make($args, ['step' => 'required|in:credentials,secret,test,deploy,activate,cursor', 'message' => 'required|string|max:300'])->validate();
        $conversation = $run->conversation;
        $step = [...$v, 'adapter_uuid' => $adapter->uuid, 'at' => now()->toIso8601String()];
        $conversation->update(['onboarding_state' => [...($conversation->fresh()->onboarding_state ?? []), 'next_step' => $step]]);
        app(AssistantEvents::class)->emit($conversation, $run, 'next_step', $step);

        return ['shown' => true, 'note' => 'The person sees a button that opens that step. Do not claim it is done until status says so.'];
    }

    private function source(string $id): array
    {
        $run = $this->run->fresh();
        $source = $run->conversation->sources()->whereKey($id)->firstOrFail();
        abort_unless(in_array($source->id, $run->source_ids ?? [], true), 422, 'Select this source in the current message.');

        return [...$source->only(['id', 'name', 'mime', 'pages']), 'text' => str_starts_with($source->mime, 'text/') || $source->mime === 'application/json' ? mb_substr(Storage::disk('local')->get($source->path), 0, 16000) : 'Inspect the selected image or PDF attachment supplied with this turn.'];
    }
}
