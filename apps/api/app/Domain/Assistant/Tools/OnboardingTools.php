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
use App\Domain\DeviceAdapters\Services\SourceSettings;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\DeviceProfiles\Support\CanonicalJson;
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
            .'propose_adapter {mode: reuse, adapter_uuid, artifact_uuid, source, summary} to continue on an existing ADAPTER from find adapters (only when its profile is the one these devices need and its source settings match theirs), or {mode: create, name, artifact_uuid, source, summary, code?, fixtures?} to create a new adapter for a published profile (artifact_uuid from find profiles; source holds non-secret settings such as {type: poll, request: {method, url, query}, credentials: {placement, name}, records, cursor}); status {}; samples {limit?}; fetch_now {}; '
            .'test_decoder {code, fixtures?: [{topic?, payload, source?}] (1-10 samples, such as the ones the person pasted), inputs?: fixtures|samples, artifact_uuid? (the profile to test against before an adapter is chosen)}; '
            .'propose_change {summary, evidence, code?, source?, fixtures?}; next_step {step: credentials|secret|test|deploy|activate|cursor, message}; read_source {source_id}. '
            .'status, samples, fetch_now, propose_change and next_step need the conversation to be bound to an adapter (after a reuse or create proposal is applied). No action reveals credentials or secrets.';
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
                'test_decoder' => $this->test($run, $args),
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
                ->map(fn (DeviceAdapter $a) => ['uuid' => $a->uuid, 'name' => $a->name, 'source_type' => $a->source['type'] ?? null, 'source' => $this->endpoint($a->source ?? []), 'profile' => $a->artifact->profile->name, 'profile_uuid' => $a->artifact->profile->uuid, 'status' => $a->status, 'live' => $a->applied_revision_uuid !== null,
                    'devices' => DeviceInstallation::whereIn('device_adapter_candidate_id', $a->candidates()->select('id'))->whereNull('ended_at')->count()])->values()->all()];
        }
        $profiles = DeviceProfileArtifact::whereHas('profile', fn ($q) => $matching($q->where('organization_id', $conversation->organization_id)))->latest('revision')->limit(100)->get()
            ->unique(fn ($artifact) => $artifact->device_profile_id)->sortByDesc(fn ($artifact) => $score($artifact->profile->name))->take(20);

        return ['profiles' => $profiles->map(fn ($artifact) => ['uuid' => $artifact->profile->uuid, 'artifact_uuid' => $artifact->uuid, 'name' => $artifact->profile->name, 'revision' => $artifact->revision,
            'parameters' => collect($artifact->definition['parameters'] ?? [])->filter(fn ($p) => ($p['reports_state'] ?? false) && ($p['kind'] ?? null) !== 'derived')->take(60)->map(fn ($p) => ['key' => $p['key'], 'data_type' => $p['data_type'], 'unit' => $p['unit'] ?? null, 'decoder_unit' => $p['ingress_conversion']['source_unit'] ?? $p['unit'] ?? null])->values()->all()])->values()->all(),
            'note' => 'Only published profiles are listed. To create an adapter for one, call propose_adapter with mode create and its artifact_uuid. Reuse an adapter only when its profile_uuid is this profile\'s uuid and its source matches the devices\' source.'];
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
            'artifact_uuid' => 'required|uuid', 'source' => 'required|array', 'fixtures' => 'sometimes|array|max:10', 'code' => 'nullable|string|max:64000',
            'evidence' => 'sometimes|array|max:20'])->validate();
        $artifact = DeviceProfileArtifact::where('uuid', $v['artifact_uuid'])->whereHas('profile', fn ($q) => $q->where('organization_id', $conversation->organization_id))->firstOrFail();
        if ($v['mode'] === 'reuse') {
            $adapter = DeviceAdapter::where('organization_id', $conversation->organization_id)->where('uuid', $v['adapter_uuid'])->firstOrFail();
            app(DeviceAuthorization::class)->authorize($conversation->user, DevicePermission::MANAGE, $conversation->organization, $adapter);
            $mismatch = $this->reuseMismatch($adapter, $artifact, $v['source']);
            abort_if($mismatch !== null, 422, "Do not reuse {$adapter->name}: {$mismatch} Propose mode create with a new adapter for these devices instead.");
            $proposal = $proposals->propose($run, ['kind' => 'reuse', 'device_adapter_id' => $adapter->id, 'name' => $adapter->name, 'summary' => $v['summary'], 'evidence' => $v['evidence'] ?? []]);
        } else {
            $fixtures = isset($v['fixtures']) ? $proposals->fixtures($v['fixtures']) : (isset($v['code']) ? $this->tested(null, $artifact) : null);
            $proposal = $proposals->propose($run, ['kind' => 'create', 'name' => $v['name'], 'artifact_uuid' => $artifact->uuid, 'source' => $proposals->source($v['source']), 'code' => $v['code'] ?? null,
                'fixtures' => $fixtures ?: null, 'summary' => $v['summary'], 'evidence' => $v['evidence'] ?? []]);
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

    /**
     * Runs a decoder against the adapter's fixtures, its captured samples, or samples given
     * inline, such as a message the person pasted. Inline samples are kept, so the next
     * decoder proposal adds them as fixtures and the person can rerun the same test.
     */
    private function test(AssistantRun $run, array $args): array
    {
        $conversation = $run->conversation;
        $adapter = $conversation->adapter;
        // Models put pasted samples under inputs as often as under fixtures.
        if (is_array($args['inputs'] ?? null)) {
            $args['fixtures'] ??= $args['inputs'];
            unset($args['inputs']);
        }
        $v = Validator::make($args, ['code' => 'required|string|max:64000', 'inputs' => 'nullable|in:fixtures,samples', 'fixtures' => 'nullable|array|min:1|max:10', 'artifact_uuid' => 'nullable|uuid'])->validate();
        $artifact = $adapter?->artifact ?? (isset($v['artifact_uuid'])
            ? DeviceProfileArtifact::where('uuid', $v['artifact_uuid'])->whereHas('profile', fn ($q) => $q->where('organization_id', $conversation->organization_id))->firstOrFail()
            : null);
        abort_unless($artifact, 422, 'No adapter is chosen yet. Pass the artifact_uuid of the published profile to test against.');
        if (isset($v['fixtures'])) {
            $fixtures = app(OnboardingProposals::class)->fixtures($v['fixtures']);
        } elseif (! $adapter) {
            abort(422, 'Pass the samples to test as fixtures, for example [{"topic": "meters/WM-1/telemetry", "payload": {...}}].');
        } else {
            $fixtures = ($v['inputs'] ?? 'fixtures') === 'samples'
                ? AdapterDelivery::where('device_adapter_id', $adapter->id)->whereIn('kind', ['sample', 'failed'])->whereNotNull('input')->latest('received_at')->limit(10)->get()->pluck('input')->filter(fn ($i) => ! ($i['truncated'] ?? false))->values()->all()
                : ($adapter->fixtures ?? []);
        }
        abort_if($fixtures === [], 422, 'There are no saved fixtures or captured samples yet. Pass the samples the person pasted as fixtures: [{"topic": "...", "payload": {...}}].');
        $result = app(AdapterManager::class)->request('/test', ['code' => $v['code'], 'fixtures' => array_slice($fixtures, 0, 10), 'profile' => $artifact->definition]);
        if (! isset($v['fixtures'])) {
            return $result;
        }
        $conversation->update(['onboarding_state' => [...($conversation->fresh()->onboarding_state ?? []), 'tested' => ['adapter_uuid' => $adapter?->uuid, 'artifact_uuid' => $artifact->uuid, 'fixtures' => $fixtures, 'at' => now()->toIso8601String()]]]);

        return [...$result, 'note' => 'Your next decoder proposal (propose_change, or propose_adapter create with code) adds these samples as fixtures unless you pass other fixtures.'];
    }

    /** The samples last tested inline for this adapter or profile, minus those it already keeps. */
    private function tested(?DeviceAdapter $adapter, DeviceProfileArtifact $artifact): ?array
    {
        $tested = $this->conversation()->onboarding_state['tested'] ?? null;
        if (! $tested || ($tested['adapter_uuid'] !== null && $tested['adapter_uuid'] !== $adapter?->uuid) || ($tested['adapter_uuid'] === null && $tested['artifact_uuid'] !== $artifact->uuid)) {
            return null;
        }
        $canonical = app(CanonicalJson::class);
        $kept = collect($adapter?->fixtures ?? [])->map(fn ($fixture) => $canonical->encode($fixture))->all();

        return collect($tested['fixtures'])->reject(fn ($fixture) => in_array($canonical->encode($fixture), $kept, true))->values()->all() ?: null;
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
        // A live adapter keeps reading where its devices are: another account or topic is another adapter.
        abort_if($source && $adapter->applied_revision_uuid !== null && ! $this->sourceCovers($source, $adapter->source ?? []), 422,
            "{$adapter->name} is live and its devices depend on where it reads. Do not repoint it; propose_adapter with mode create for the other account, endpoint or topics.");
        $fixtures = isset($v['fixtures']) ? $proposals->fixtures($v['fixtures']) : (isset($v['code']) ? $this->tested($adapter, $adapter->artifact) : null);
        $proposal = $proposals->propose($run, ['kind' => 'change', 'device_adapter_id' => $adapter->id, 'draft_revision' => $adapter->draft_revision, 'code' => $v['code'] ?? null, 'source' => $source,
            'fixtures' => $fixtures ?: null, 'summary' => $v['summary'], 'evidence' => $v['evidence'] ?: [['origin' => 'suggested', 'note' => 'Review against the vendor documentation and the samples.']]]);

        return [...$proposals->view($proposal), 'note' => 'Shown to the person for review. Applying it saves a new draft revision; tests and deployment stay with them.'];
    }

    /** Where a source reads from, without secrets: the topics, broker, endpoint and account it is tied to. */
    private function endpoint(array $source): array
    {
        $static = fn (array $pairs) => collect($pairs)->reject(fn ($pair) => preg_match('/\{('.implode('|', SourceSettings::PLACEHOLDERS).')\}/', (string) ($pair['value'] ?? '')))
            ->mapWithKeys(fn ($pair) => [strtolower((string) ($pair['name'] ?? '')) => (string) ($pair['value'] ?? '')])->sortKeys()->all();

        return match ($source['type'] ?? null) {
            'platform' => ['topics' => array_values($source['topics'] ?? [])],
            'vendor' => ['url' => rtrim(strtolower((string) ($source['url'] ?? '')), '/'), 'topics' => array_values($source['topics'] ?? [])],
            'webhook' => ['auth' => $source['auth']['mode'] ?? null, 'signature_header' => isset($source['auth']['signature_header']) ? strtolower($source['auth']['signature_header']) : null],
            'poll' => ['method' => strtoupper((string) ($source['request']['method'] ?? 'GET')), 'url' => rtrim((string) ($source['request']['url'] ?? ''), '/'),
                'query' => $static($source['request']['query'] ?? []), 'headers' => $static($source['request']['headers'] ?? [])],
            default => [],
        };
    }

    /** Whether $current already reads everything $wanted needs: the same broker, endpoint or signature, and every wanted topic. */
    private function sourceCovers(array $wanted, array $current): bool
    {
        if (($wanted['type'] ?? null) !== ($current['type'] ?? null)) {
            return false;
        }
        $have = $this->endpoint($current);
        $want = $this->endpoint($wanted);
        if (! in_array($current['type'], ['platform', 'vendor'], true)) {
            return $want === $have;
        }

        return ($want['url'] ?? null) === ($have['url'] ?? null) && $want['topics'] !== []
            && collect($want['topics'])->every(fn ($topic) => collect($have['topics'])->contains(fn ($filter) => self::topicMatches($filter, $topic)));
    }

    /** Why an adapter cannot take these devices, or null when its profile and source fit them. */
    private function reuseMismatch(DeviceAdapter $adapter, DeviceProfileArtifact $artifact, array $source): ?string
    {
        if ($adapter->artifact->device_profile_id !== $artifact->device_profile_id) {
            return "it decodes {$adapter->artifact->profile->name} devices, not {$artifact->profile->name}.";
        }
        if (($source['type'] ?? null) !== ($adapter->source['type'] ?? null)) {
            return 'it receives data another way ('.($adapter->source['type'] ?? 'unknown').', not '.$source['type'].').';
        }

        return $this->sourceCovers($source, $adapter->source ?? []) ? null : 'it reads from '.json_encode($this->endpoint($adapter->source ?? []), JSON_UNESCAPED_SLASHES).', not from where these devices send data.';
    }

    /** MQTT filter matching: + is one level, # the rest; a wanted filter matches only where it is no broader. */
    private static function topicMatches(string $filter, string $topic): bool
    {
        $filterLevels = explode('/', $filter);
        $topicLevels = explode('/', $topic);
        foreach ($filterLevels as $index => $level) {
            if ($level === '#') {
                return true;
            }
            if (! array_key_exists($index, $topicLevels) || $topicLevels[$index] === '#' || ($level !== '+' && $level !== $topicLevels[$index])) {
                return false;
            }
        }

        return count($filterLevels) === count($topicLevels);
    }

    /** Evidence as the review card shows it; models send strings or loose objects. */
    private function evidence(mixed $evidence): array
    {
        return collect(is_array($evidence) ? $evidence : ($evidence ? [$evidence] : []))->take(20)->map(function ($entry) {
            if (! is_array($entry)) {
                return ['origin' => 'suggested', 'note' => mb_substr(is_scalar($entry) ? (string) $entry : json_encode($entry), 0, 1000)];
            }
            $origin = in_array($entry['origin'] ?? null, ['source', 'user_stated', 'user_confirmed', 'suggested', 'unresolved'], true) ? $entry['origin'] : 'suggested';
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
