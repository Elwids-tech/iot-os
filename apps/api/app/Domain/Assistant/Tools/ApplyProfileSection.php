<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Tools;

use App\Domain\Assistant\Models\AssistantRun;
use App\Domain\Assistant\Services\ProfileProposalService;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Ai\Concerns\InteractsWithApprovals;
use Laravel\Ai\Contracts\Approvable;
use Laravel\Ai\Contracts\Tool;
use Laravel\Ai\Tools\Request;
use Stringable;

final class ApplyProfileSection implements Approvable, Tool
{
    use InteractsWithApprovals;

    public function __construct(private readonly AssistantRun $run) {}

    public function description(): Stringable|string
    {
        return 'Request human review and approval of exactly one previously previewed profile section. Execution requires an authenticated review-card approval of its content hash. Never call this for a proposal with blocking diagnostics.';
    }

    public function schema(JsonSchema $schema): array
    {
        return ['proposal_id' => $schema->string()->required(), 'content_hash' => $schema->string()->required()];
    }

    public function handle(Request $request): Stringable|string
    {
        $run = $this->run->fresh();
        abort_unless($run && $run->status === 'running', 409, 'This run has stopped.');
        $proposal = $run->conversation->proposals()->findOrFail($request['proposal_id']);

        return json_encode(app(ProfileProposalService::class)->apply($proposal, $request['content_hash']), JSON_THROW_ON_ERROR);
    }
}
