<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Tools;

use App\Domain\Assistant\Models\AssistantRun;
use App\Domain\Assistant\Services\AssistantAccess;
use App\Domain\Assistant\Services\AssistantEvents;
use App\Domain\Assistant\Services\AssistantQuestions;
use App\Domain\Assistant\Services\ProfileKnowledge;
use App\Domain\Assistant\Services\ProfileProposalService;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Services\DeviceProfileValidator;
use App\Domain\DeviceProfiles\Services\RestrictedExpression;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Laravel\Ai\Contracts\Tool;
use Laravel\Ai\Tools\Request;
use Stringable;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Throwable;

final class ProfileAssistantTools implements Tool
{
    public function __construct(private readonly AssistantRun $run) {}

    public function description(): Stringable|string
    {
        return 'Authorized profile workspace tools. Actions: schema (editable fields and required/optional questions), read_target, find_profiles (query), read_profile (uuid), source (source_id), record_facts (facts array of field, value string, source_id (omit for what the person said in chat), location, certainty explicit|inferred|uncertain), ask_questions (questions array, max 3, each with id, prompt, required boolean, options string array), preview_section (section, summary, changes array of {operation: upsert|remove, uuid or null, values}, evidence array of {field, origin, source_id?, location?, note?}), validate, test_calculation (expression object, samples object). '
            .'Evidence origin is user_stated for what the person said in chat (no source_id), source for an attached file (with source_id), user_confirmed, suggested for your own defaults, or unresolved (blocks applying). Arguments are encoded as a JSON object to support the existing extensible JSON Logic and profile schema. No action saves a profile; preview_section returns an immutable review proposal. Use ApplyProfileSection afterward to request human approval.';
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'action' => $schema->string()->enum(['schema', 'read_target', 'find_profiles', 'read_profile', 'source', 'record_facts', 'ask_questions', 'preview_section', 'validate', 'test_calculation'])->required(),
            'arguments_json' => $schema->string()->description('A JSON object with the action arguments. Use {} when no arguments are needed.')->required(),
        ];
    }

    public function handle(Request $request): Stringable|string
    {
        try {
            $run = $this->run->fresh();
            abort_unless($run !== null && $run->status === 'running', 409, 'This assistant run is no longer active.');
            $conversation = $run->conversation;
            app(AssistantAccess::class)->conversation($conversation->user, $conversation->organization, $conversation);
            $arguments = json_decode($request['arguments_json'], true, 64, JSON_THROW_ON_ERROR);
            abort_unless(is_array($arguments), 422, 'Arguments must be an object.');
            $service = app(ProfileProposalService::class);
            $result = match ($request['action']) {
                'schema' => app(ProfileKnowledge::class)->describe(),
                'read_target' => $service->snapshot($conversation->profile),
                'find_profiles' => $this->findProfiles((string) ($arguments['query'] ?? '')),
                'read_profile' => $service->snapshot(app(AssistantAccess::class)->profile($conversation->user, $conversation->organization, (string) ($arguments['uuid'] ?? ''))),
                'source' => $this->source((string) ($arguments['source_id'] ?? '')),
                'ask_questions' => $this->questions($arguments),
                'record_facts' => $this->recordFacts($arguments),
                'preview_section' => $this->proposal($service->preview($conversation, [...$arguments, 'evidence' => $this->evidence($arguments['evidence'] ?? [])], $run)->toArray()),
                'validate' => ['diagnostics' => $conversation->profile ? array_map(fn ($d) => $d->toArray(), app(DeviceProfileValidator::class)->validate($conversation->profile)) : [['code' => 'profile.required', 'message' => 'Create the profile identity first.']]],
                'test_calculation' => $this->testCalculation($arguments),
            };

            return json_encode($result, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        } catch (Throwable $exception) {
            $details = $exception instanceof ValidationException ? $exception->errors() : [];

            return json_encode(['error' => 'The requested profile operation was not completed.', 'details' => $details, 'reason' => $exception instanceof HttpExceptionInterface ? $exception->getMessage() : null,
                'next' => 'Fix the named arguments and call again. These details are for you; tell the person only what you need from them, in plain words.'], JSON_THROW_ON_ERROR);
        }
    }

    /**
     * Evidence as the review card shows it. What the person typed is evidence too: it is
     * user_stated and cites no file. Loose entries from the model become suggestions.
     */
    private function evidence(mixed $evidence): array
    {
        $said = ['user_stated', 'user', 'chat', 'message', 'conversation', 'user_message', 'person'];

        return collect(is_array($evidence) && ! array_is_list($evidence) ? [$evidence] : (is_array($evidence) ? $evidence : [$evidence]))->filter(fn ($entry) => filled($entry))->take(100)->map(function ($entry) use ($said) {
            if (! is_array($entry)) {
                return ['field' => 'section', 'origin' => 'suggested', 'note' => mb_substr(is_scalar($entry) ? (string) $entry : json_encode($entry), 0, 1000)];
            }
            $origin = strtolower((string) ($entry['origin'] ?? 'suggested'));
            $origin = in_array($origin, $said, true) ? 'user_stated' : (in_array($origin, ['source', 'user_confirmed', 'suggested', 'unresolved'], true) ? $origin : 'suggested');
            $note = $entry['note'] ?? $entry['text'] ?? $entry['quote'] ?? null;
            $sourceId = is_string($entry['source_id'] ?? null) && Str::isUuid($entry['source_id']) ? $entry['source_id'] : null;

            return array_filter(['field' => mb_substr((string) ($entry['field'] ?? 'section'), 0, 255), 'origin' => $origin, 'source_id' => $sourceId,
                'location' => isset($entry['location']) ? mb_substr((string) $entry['location'], 0, 255) : null, 'note' => $note !== null ? mb_substr(is_scalar($note) ? (string) $note : json_encode($note), 0, 1000) : null], fn ($value) => $value !== null);
        })->values()->all();
    }

    private function proposal(array $proposal): array
    {
        return Arr::only($proposal, ['id', 'content_hash', 'section', 'summary', 'changes', 'diagnostics']);
    }

    private function findProfiles(string $query): array
    {
        $conversation = $this->run->conversation;
        abort_unless(app(AssistantAccess::class)->capabilities($conversation->user, $conversation->organization)['view_any'] ?? false, 403);

        return DeviceProfile::query()->where('organization_id', $conversation->organization_id)->where('name', 'like', '%'.mb_substr($query, 0, 100).'%')->limit(10)->get(['uuid', 'name', 'code', 'status'])->toArray();
    }

    private function source(string $id): array
    {
        $source = $this->run->conversation->sources()->findOrFail($id);
        $result = $source->only(['id', 'name', 'mime', 'size', 'pages']);
        if (str_starts_with($source->mime, 'text/') || $source->mime === 'application/json') {
            $result['text'] = mb_substr(Storage::disk('local')->get($source->path), 0, 20000);
        } else {
            $result['note'] = 'Use the attached source to inspect images or PDF pages. If it is not in this turn, ask the user to attach/select it.';
        }

        return $result;
    }

    private function questions(array $arguments): array
    {
        return app(AssistantQuestions::class)->ask($this->run, $arguments);
    }

    private function testCalculation(array $arguments): array
    {
        $data = Validator::make($arguments, ['expression' => ['required', 'array'], 'samples' => ['required', 'array']])->validate();
        $evaluator = app(RestrictedExpression::class);
        $diagnostics = $evaluator->diagnostics($data['expression'], array_keys($data['samples']), '/expression', 'calculation');

        return ['valid' => $diagnostics === [], 'diagnostics' => array_map(fn ($d) => $d->toArray(), $diagnostics), 'result' => $diagnostics === [] ? $evaluator->evaluate($data['expression'], $data['samples']) : null];
    }

    private function recordFacts(array $arguments): array
    {
        $data = Validator::make($arguments, [
            'facts' => ['required', 'array', 'min:1', 'max:30'],
            'facts.*.field' => ['required', 'string', 'max:200'],
            'facts.*.value' => ['required', 'string', 'max:1000'],
            'facts.*.source_id' => ['nullable', 'uuid'],
            'facts.*.location' => ['nullable', 'string', 'max:200'],
            'facts.*.certainty' => ['required', 'in:explicit,inferred,uncertain'],
        ])->validate();
        $conversation = $this->run->conversation->fresh();
        foreach ($data['facts'] as $fact) {
            abort_unless(empty($fact['source_id']) || $conversation->sources()->whereKey($fact['source_id'])->exists(), 422, 'The source is unavailable in this conversation.');
        }
        // A fact without a source is something the person said in this conversation.
        $facts = array_map(fn ($fact) => empty($fact['source_id']) ? [...$fact, 'source_id' => null, 'origin' => 'user_stated'] : $fact, $data['facts']);
        $state = $conversation->onboarding_state ?? [];
        $state['source_facts'] = collect([...($state['source_facts'] ?? []), ...$facts])->keyBy(fn ($fact) => ($fact['source_id'] ?? 'message').'/'.$fact['field'])->values()->all();
        $conversation->update(['onboarding_state' => $state]);
        app(AssistantEvents::class)->emit($conversation, $this->run, 'source_facts', ['facts' => $facts]);

        return ['recorded' => count($data['facts'])];
    }
}
