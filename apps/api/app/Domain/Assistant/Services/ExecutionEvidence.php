<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Services;

use App\Domain\Assistant\Models\AssistantConversation;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Automation\Services\DagAuthorization;
use App\Domain\Automation\Services\DagTimeline;

final class ExecutionEvidence
{
    public function capture(AssistantConversation $conversation, string $evaluationId): array
    {
        abort_unless($conversation->scope === 'automation' && $conversation->automation_workflow_id, 422, 'Select an execution from a saved workflow.');
        $workflow = Workflow::where('organization_id', $conversation->organization_id)->findOrFail($conversation->automation_workflow_id);
        app(DagAuthorization::class)->authorize($conversation->user, $conversation->organization, 'view', $workflow);
        $evaluation = app(DagTimeline::class)->read($conversation->organization, $workflow, null, $evaluationId)['data'];
        $evaluation['citation'] = '[evaluation]';
        foreach ($evaluation['trace'] as $index => &$step) {
            $step['citation'] = '[step:'.($index + 1).']';
        }
        unset($step);
        foreach ($evaluation['actions'] as $index => &$action) {
            $action['citation'] = '[action:'.($index + 1).']';
        }
        unset($action);
        $context = [
            'workflow_uuid' => $workflow->uuid,
            'workflow_name' => $workflow->name,
            'captured_at' => now()->toIso8601String(),
            'evaluation' => $evaluation,
        ];
        // Refuse oversized evidence rather than silently removing decisive steps.
        abort_if(strlen(json_encode($context, JSON_THROW_ON_ERROR)) > config('assistant.max_context_characters'), 422, 'This execution contains too much evidence for the assistant. Inspect its node decisions in the timeline.');

        return $context;
    }

    public function references(?array $context): ?array
    {
        if (! $context) {
            return null;
        }
        $entry = $context['evaluation'];

        return [
            'workflow_uuid' => $context['workflow_uuid'], 'evaluation_id' => $entry['id'],
            'captured_at' => $context['captured_at'], 'at' => $entry['at'],
            'generation' => $entry['generation'], 'draft_revision' => $entry['draft_revision'],
            'trace_truncated' => $entry['trace_truncated'],
            'steps' => array_map(fn ($step) => ['node_id' => $step['node_id'], 'node_type' => $step['node_type']], $entry['trace']),
            'actions' => array_map(fn ($action) => ['id' => $action['id'], 'node_id' => $action['node_id'] ?? null], $entry['actions']),
        ];
    }
}
