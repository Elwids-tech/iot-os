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
    public const STARTER = "function decode(input) {\n  const p = input.payload;\n  return {\n    sourceDeviceId: String(p.deviceId),\n    metrics: [],\n  };\n}";

    public function list(AssistantConversation $conversation): array
    {
        return AdapterProposal::where('conversation_id', $conversation->id)->where('user_id', $conversation->user_id)->oldest()->limit(50)->get()->map(fn ($p) => $this->view($p))->all();
    }

    public function view(AdapterProposal $p): array
    {
        $adapter = $p->device_adapter_id ? DeviceAdapter::find($p->device_adapter_id) : null;

        return [...$p->only(['uuid', 'kind', 'name', 'artifact_uuid', 'code', 'source', 'fixtures', 'summary', 'evidence', 'content_hash', 'draft_revision', 'status']), 'adapter_uuid' => $adapter?->uuid, 'adapter_name' => $adapter?->name, 'created_at' => $p->created_at?->toIso8601String()];
    }

    public function propose(AssistantRun $run, array $content): AdapterProposal
    {
        $conversation = $run->conversation;
        $content = array_filter($content, fn ($value) => $value !== null);
        $hashed = ['kind' => $content['kind'], ...$content];
        $proposal = AdapterProposal::create([...$content, 'organization_id' => $conversation->organization_id, 'conversation_id' => $conversation->id, 'user_id' => $conversation->user_id,
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

    public function source(array $source): array
    {
        return app(SourceSettings::class)->normalize($source);
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
                $fixtures = $adapter->fixtures ?? [];
                foreach ($p->fixtures ?? [] as $fixture) {
                    if (! in_array($fixture, $fixtures, true)) {
                        $fixtures[] = $fixture;
                    }
                }
                abort_if(count($fixtures) > 10, 422, 'An adapter keeps at most 10 fixtures. Remove some before applying.');
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
