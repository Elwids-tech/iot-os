<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Domain\Devices\Services\RuntimeStatus;
use Illuminate\Console\Command;

final class RecoverWorkflowCheckpoint extends Command
{
    protected $signature = 'devices:recover-workflow-checkpoint {--reason= : Recorded in the runtime log} {--force : Skip the confirmation prompt}';

    protected $description = 'Resume paused workflow evaluation after its telemetry checkpoint lost continuity';

    public function handle(RuntimeStatus $status): int
    {
        $diagnostics = $status->diagnostics();
        $fault = $diagnostics['workflows']['fault'] ?? null;
        if (($fault['code'] ?? null) !== 'checkpoint_continuity') {
            $this->info('Workflow evaluation is '.($diagnostics['workflows']['state'] ?? 'unknown').'; there is no lost checkpoint to recover.');

            return self::SUCCESS;
        }
        $this->warn("Workflow evaluation has been paused since {$fault['since']}: {$fault['message']}");
        $this->line('Recovery resumes evaluation from the newest retained telemetry. Readings between the old checkpoint and now are never evaluated, so alerts and actions they would have caused will not happen. Device data, history and commands are unaffected.');
        $reason = $this->option('reason') ?: ($this->option('force') ? null : $this->ask('Reason for the incident record'));
        if (! is_string($reason) || mb_strlen(trim($reason)) < 3) {
            $this->error('A reason of at least three characters is required.');

            return self::FAILURE;
        }
        if (! $this->option('force') && ! $this->confirm('Skip the unevaluated telemetry and resume workflow evaluation?')) {
            $this->line('Nothing changed.');

            return self::FAILURE;
        }
        $result = $status->rebaselineWorkflowCheckpoint(trim($reason));
        $this->info(sprintf(
            'Workflow evaluation resumes after stream sequence %s (previous checkpoint: sequence %s on stream created %s).',
            $result['current']['sequence'] ?? '?',
            $result['previous']['sequence'] ?? '?',
            $result['previous']['stream_created'] ?? '?',
        ));

        return self::SUCCESS;
    }
}
