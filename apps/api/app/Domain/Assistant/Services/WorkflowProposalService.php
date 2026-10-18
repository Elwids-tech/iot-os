<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Services;

use App\Domain\Assistant\Models\AssistantConversation;
use App\Domain\Assistant\Models\AssistantProposal;
use App\Domain\Assistant\Models\AssistantRun;
use App\Domain\Automation\Services\DagAuthoring;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class WorkflowProposalService
{
    public function preview(AssistantConversation $conversation, array $input, AssistantRun $run): AssistantProposal
    {
        app(AssistantAccess::class)->conversation($conversation->user, $conversation->organization, $conversation);
        abort_unless($conversation->scope === 'automation', 422);
        $data = validator($input, ['summary' => 'required|string|max:255', 'workflow' => 'required|array'])->validate();
        foreach ($data['workflow']['nodes'] ?? [] as $node) {
            if (($node['type'] ?? '') === 'action.command.v1') {
                app(DeviceAuthorization::class)->authorize($conversation->user, DevicePermission::COMMAND, $conversation->organization);
            }
        }
        $context = app(WorkflowDraftContext::class);
        $proposed = $context->restore($data['workflow'], $conversation->onboarding_state['target'] ?? []);
        // Proposals must use the current applied configuration, not invented or obsolete bindings.
        // Name each binding so the model can refresh it rather than retry blindly.
        $outdated = $context->outdatedBindings($conversation->organization_id, (array) ($proposed['bindings'] ?? []));
        if ($outdated !== []) {
            throw ValidationException::withMessages(['bindings' => array_values($outdated)]);
        }
        $compiled = app(DagAuthoring::class)->compile($conversation->organization, $proposed, $conversation->workflow?->uuid ?? (string) Str::uuid());
        $diagnostics = $compiled['diagnostics'] ?? [];
        if (! ($compiled['valid'] ?? false)) {
            throw ValidationException::withMessages(['workflow' => array_map(fn ($d) => ($d['node_id'] ?? 'graph').': '.$d['message'], $diagnostics) ?: ['Invalid workflow.']]);
        }
        $workflow = $compiled['definition'];
        unset($workflow['uuid'], $workflow['version_uuid'], $workflow['organization_uuid']);

        return DB::transaction(function () use ($conversation, $run, $data, $workflow, $diagnostics): AssistantProposal {
            $locked = AssistantConversation::whereKey($conversation->id)->lockForUpdate()->firstOrFail();
            abort_unless($run->fresh()?->status === 'running', 409, 'This response was stopped.');
            $before = $locked->onboarding_state['target'];
            $changes = [['operation' => 'upsert', 'values' => ['workflow' => $workflow]]];
            $locked->proposals()->where('status', 'pending')->update(['status' => 'superseded']);
            $proposal = $locked->proposals()->create([
                'run_id' => $run->id, 'section' => 'workflow', 'summary' => $data['summary'],
                'draft_revision' => $before['draft_revision'] ?? null,
                'before' => $before, 'changes' => $changes, 'evidence' => [], 'diagnostics' => $diagnostics,
                'content_hash' => hash('sha256', json_encode([$locked->id, $before, $changes], JSON_THROW_ON_ERROR)),
            ]);
            app(AssistantEvents::class)->emit($locked, $run, 'proposal', ['proposal_id' => $proposal->id]);

            return $proposal;
        });
    }
}
