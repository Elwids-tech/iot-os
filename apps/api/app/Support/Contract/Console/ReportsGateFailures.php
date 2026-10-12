<?php

declare(strict_types=1);

namespace App\Support\Contract\Console;

/**
 * Failure lines in the format of specs/001-openapi-contract/contracts/ci-gate.md:
 *
 *     contract <gate>: <subject>: <difference>
 *       fix: <the command or file to change>
 *
 * plus a GitHub annotation when running in Actions.
 */
trait ReportsGateFailures
{
    protected function gateFailure(string $gate, string $subject, string $difference, string $fix): void
    {
        $line = "contract {$gate}: {$subject}: {$difference}";
        $this->line("<fg=red>{$line}</>");
        $this->line("  fix: {$fix}");
        if (getenv('GITHUB_ACTIONS') === 'true') {
            $this->line('::error title=contract '.$gate.'::'.str_replace(["\r", "\n", '%'], ['%0D', '%0A', '%25'], $line.' (fix: '.$fix.')'));
        }
    }
}
