<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Services;

use App\Domain\Assistant\Models\AssistantConversation;
use App\Domain\Assistant\Models\AssistantRun;
use App\Domain\DeviceAdapters\Models\AdapterProposal;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\DeviceAdapters\Services\AdapterService;
use App\Domain\DeviceAdapters\Services\SourceSettings;
use App\Domain\DeviceProfiles\Support\CanonicalJson;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

/**
 * Proposals from the device onboarding assistant (spec 020, FR-104 and FR-106): reuse
 * an adapter, create a draft adapter, or change a draft's decoder, non-secret source
 * settings and fixtures. Only a person's decision applies one.
 */
final class OnboardingProposals
{
    /** How many fixtures an adapter keeps (the same limit as a save). */
    public const MAX_FIXTURES = 10;

    public const STARTER = "function decode(input) {\n  const p = input.payload;\n  return {\n    sourceDeviceId: String(p.deviceId),\n    metrics: [],\n  };\n}";

    public function list(AssistantConversation $conversation): array
    {
        return AdapterProposal::where('conversation_id', $conversation->id)->where('user_id', $conversation->user_id)->oldest()->limit(50)->get()->map(fn ($p) => $this->view($p))->all();
    }

    public function view(AdapterProposal $p): array
    {
        $adapter = $p->device_adapter_id ? DeviceAdapter::find($p->device_adapter_id) : null;

        return [...$p->only(['uuid', 'kind', 'name', 'artifact_uuid', 'code', 'source', 'fixtures', 'removed_fixtures', 'summary', 'evidence', 'content_hash', 'draft_revision', 'status']), 'adapter_uuid' => $adapter?->uuid, 'adapter_name' => $adapter?->name, 'created_at' => $p->created_at?->toIso8601String()];
    }

    public function propose(AssistantRun $run, array $content): AdapterProposal
    {
        return $this->create($run->conversation, $run, $content);
    }

    private function create(AssistantConversation $conversation, ?AssistantRun $run, array $content): AdapterProposal
    {
        $content = array_filter($content, fn ($value) => $value !== null);
        $hashed = ['kind' => $content['kind'], ...$content];
        $proposal = AdapterProposal::create([...$content, 'status' => 'pending', 'organization_id' => $conversation->organization_id, 'conversation_id' => $conversation->id, 'user_id' => $conversation->user_id,
            'summary' => mb_substr((string) ($content['summary'] ?? ''), 0, 1000), 'evidence' => $content['evidence'] ?? [], 'content_hash' => hash('sha256', app(CanonicalJson::class)->encode($hashed))]);
        app(AssistantEvents::class)->emit($conversation, $run, 'adapter_proposal', $proposal->only(['uuid', 'kind', 'summary', 'content_hash', 'draft_revision']));

        return $proposal;
    }

    /** Validates fixtures the assistant proposes against the same rules as a save. */
    public function fixtures(array $fixtures): array
    {
        Validator::make(['fixtures' => $fixtures], ['fixtures' => 'array|max:10', 'fixtures.*.topic' => 'nullable|string|max:255', 'fixtures.*.payload' => 'nullable', 'fixtures.*.payload_base64' => 'nullable|string|max:1398104',
            'fixtures.*.expect_error' => 'sometimes|boolean', 'fixtures.*.expected' => 'sometimes|array', 'fixtures.*.source' => 'sometimes|in:mqtt,webhook,poll', 'fixtures.*.received_at' => 'sometimes|nullable|date',
            'fixtures.*.http' => 'sometimes|nullable|array', 'fixtures.*.poll' => 'sometimes|nullable|array'])->validate();
        foreach ($fixtures as $fixture) {
            abort_unless(array_key_exists('payload', $fixture) || filled($fixture['payload_base64'] ?? null), 422, 'Each fixture requires a payload.');
        }

        return array_values($fixtures);
    }

    /** The adapter's fixtures without the removed ones and with the proposed ones added, as applying the proposal saves them. */
    public function merged(DeviceAdapter $adapter, ?array $proposed, ?array $removed = null): array
    {
        $fixtures = array_values(array_filter($adapter->fixtures ?? [], fn ($fixture) => ! in_array($fixture, $removed ?? [], true)));
        foreach ($proposed ?? [] as $fixture) {
            if (! in_array($fixture, $fixtures, true)) {
                $fixtures[] = $fixture;
            }
        }

        return $fixtures;
    }

    /**
     * The adapter's saved samples, numbered from 1 as remove_fixtures names them, each with
     * its topic and the start of its payload, so the assistant can say which ones to swap.
     */
    public function savedSamples(DeviceAdapter $adapter): array
    {
        return collect($adapter->fixtures ?? [])->values()->map(fn ($fixture, $index) => ['n' => $index + 1, 'topic' => $fixture['topic'] ?? null,
            'payload' => mb_substr((string) json_encode($fixture['payload'] ?? ($fixture['payload_base64'] ?? null), JSON_UNESCAPED_SLASHES), 0, 160)])->all();
    }

    /** This conversation's proposals still waiting on the person; a change made against an older draft is outdated and cannot apply. */
    public function pending(AssistantConversation $conversation, ?DeviceAdapter $adapter): array
    {
        return AdapterProposal::where('conversation_id', $conversation->id)->where('status', 'pending')->oldest()->limit(20)->get()
            ->map(fn (AdapterProposal $p) => ['uuid' => $p->uuid, 'kind' => $p->kind, 'summary' => mb_substr((string) $p->summary, 0, 200), 'draft_revision' => $p->draft_revision,
                'outdated' => $p->kind === 'change' && $p->draft_revision !== $adapter?->draft_revision, 'adds_fixtures' => count($p->fixtures ?? []), 'removes_fixtures' => count($p->removed_fixtures ?? [])])->all();
    }

    public function source(array $source): array
    {
        return app(SourceSettings::class)->normalize($source);
    }

    /**
     * Makes an outdated change again against the adapter's current draft: the same decoder,
     * settings and samples (its code passed a test when first proposed), minus removals the
     * draft no longer needs, and retires the old card. The assistant's repropose action and
     * the card's own button both come here.
     */
    public function renew(AdapterProposal $old, ?AssistantRun $run = null): AdapterProposal
    {
        return DB::transaction(function () use ($old, $run) {
            $old = AdapterProposal::whereKey($old->id)->lockForUpdate()->firstOrFail();
            abort_unless($old->status === 'pending' && $old->kind === 'change', 409, 'Only a pending change can be made again.');
            $adapter = DeviceAdapter::findOrFail($old->device_adapter_id);
            abort_if($old->draft_revision === $adapter->draft_revision, 409, 'This card is for the current draft and can be applied as it is. If Apply is off, the person has unsaved edits on the page: they save or discard them first.');
            $removed = array_values(array_filter($old->removed_fixtures ?? [], fn ($fixture) => in_array($fixture, $adapter->fixtures ?? [], true))) ?: null;
            $total = count($this->merged($adapter, $old->fixtures, $removed));
            abort_if($total > self::MAX_FIXTURES, 409, "With today's draft this change would leave {$total} samples, more than ".self::MAX_FIXTURES.'. Ask the assistant for a new proposal that swaps out saved samples.');
            $conversation = AssistantConversation::findOrFail($old->conversation_id);
            $proposal = $this->create($conversation, $run, ['kind' => 'change', 'device_adapter_id' => $adapter->id, 'draft_revision' => $adapter->draft_revision, 'code' => $old->code, 'source' => $old->source,
                'fixtures' => $old->fixtures ?: null, 'removed_fixtures' => $removed, 'summary' => $old->summary, 'evidence' => $old->evidence ?: []]);
            $old->update(['status' => 'rejected']);

            return $proposal;
        });
    }

    /** Applies or rejects a proposal; idempotent for the same decision. */
    public function decide(AdapterProposal $proposal, User $user, Organization $organization, string $action, string $hash): array
    {
        abort_unless($proposal->user_id === $user->id && $proposal->organization_id === $organization->id, 404);
        $conversation = AssistantConversation::where('user_id', $user->id)->find($proposal->conversation_id);

        return DB::transaction(function () use ($proposal, $user, $organization, $action, $hash, $conversation) {
            $p = AdapterProposal::whereKey($proposal->id)->lockForUpdate()->firstOrFail();
            abort_unless(hash_equals($p->content_hash, $hash), 409, 'This proposal changed. Review the latest one.');
            if ($p->status === 'applied' && $action === 'apply' || $p->status === 'rejected' && $action === 'reject') {
                return ['status' => $p->status, 'adapter' => $p->device_adapter_id ? app(AdapterService::class)->view(DeviceAdapter::findOrFail($p->device_adapter_id)) : null];
            }
            abort_unless($p->status === 'pending', 409, 'This proposal was already reviewed.');
            if ($action === 'reject') {
                $p->update(['status' => 'rejected']);

                return ['status' => 'rejected', 'adapter' => null];
            }
            $authorization = app(DeviceAuthorization::class);
            $service = app(AdapterService::class);
            if ($p->kind === 'reuse') {
                $adapter = DeviceAdapter::where('organization_id', $organization->id)->whereKey($p->device_adapter_id)->firstOrFail();
                $authorization->authorize($user, DevicePermission::MANAGE, $organization, $adapter);
                $saved = $adapter;
            } elseif ($p->kind === 'create') {
                $authorization->authorize($user, DevicePermission::MANAGE, $organization);
                $authorization->authorize($user, DevicePermission::CONNECTIONS, $organization);
                $saved = $service->save($organization, ['request_uuid' => (string) Str::uuid(), 'name' => $p->name, 'artifact_uuid' => $p->artifact_uuid, 'code' => $p->code ?? self::STARTER, 'fixtures' => $p->fixtures ?? [], 'source' => $p->source], $user->id);
                $p->device_adapter_id = $saved->id;
            } else {
                $adapter = DeviceAdapter::where('organization_id', $organization->id)->whereKey($p->device_adapter_id)->firstOrFail();
                $authorization->authorize($user, DevicePermission::MANAGE, $organization, $adapter);
                $authorization->authorize($user, DevicePermission::CONNECTIONS, $organization);
                $fixtures = $this->merged($adapter, $p->fixtures, $p->removed_fixtures);
                abort_if(count($fixtures) > self::MAX_FIXTURES, 422, 'An adapter keeps at most '.self::MAX_FIXTURES.' fixtures. Remove some before applying.');
                $saved = $service->save($organization, ['name' => $adapter->name, 'artifact_uuid' => $adapter->artifact->uuid, 'code' => $p->code ?? $adapter->code, 'fixtures' => $fixtures, 'source' => $p->source ?? $adapter->source], $user->id, $adapter, $p->draft_revision);
            }
            $p->status = 'applied';
            $p->save();
            if ($conversation?->scope === 'onboarding') {
                AssistantConversation::whereKey($conversation->id)->update(['device_adapter_id' => $saved->id]);
            }

            return ['status' => 'applied', 'adapter' => $service->view($saved->fresh())];
        });
    }
}
