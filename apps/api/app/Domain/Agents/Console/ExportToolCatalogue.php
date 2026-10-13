<?php

declare(strict_types=1);

namespace App\Domain\Agents\Console;

use App\Domain\Agents\Mcp\AgentTool;
use App\Domain\Agents\Mcp\PlatformServer;
use Illuminate\Console\Command;

/**
 * The agent tool catalogue is a public contract (spec 004 D12): CI fails when a tool
 * changes without contracts/agents/tools.json, or when a tool could destroy anything.
 */
final class ExportToolCatalogue extends Command
{
    public const VERSION = 1;

    protected $signature = 'agents:tools {--export : Write contracts/agents/tools.json} {--check : Fail unless the committed catalogue is current}';

    protected $description = 'Export or check the AI agent tool catalogue';

    public function handle(): int
    {
        $tools = collect(PlatformServer::TOOLS)->map(function (string $class): array {
            /** @var AgentTool $tool */
            $tool = app($class);
            $entry = $tool->toArray();
            unset($entry['_meta']);

            return [...$entry, 'access_level' => $tool->accessLevel()->value, 'permission' => $tool->permission()];
        })->sortBy('name')->values();

        $destructive = $tools->filter(fn (array $tool): bool => ($tool['annotations']['destructiveHint'] ?? false) === true)->pluck('name');
        if ($destructive->isNotEmpty()) {
            $this->error('Agents never get destructive tools (spec 004 FR-031): '.$destructive->implode(', '));

            return self::FAILURE;
        }

        $json = json_encode(['catalogue_version' => self::VERSION, 'server' => 'iot-os', 'tools' => $tools->all()], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)."\n";
        $path = base_path('../../contracts/agents/tools.json');

        if ($this->option('check')) {
            if (! is_file($path) || file_get_contents($path) !== $json) {
                $this->error('contracts/agents/tools.json is out of date. Run php artisan agents:tools --export and commit it.');

                return self::FAILURE;
            }
            $this->info("contracts/agents/tools.json is current ({$tools->count()} tools).");

            return self::SUCCESS;
        }

        if (! is_dir(dirname($path))) {
            mkdir(dirname($path), 0755, true);
        }
        file_put_contents($path, $json);
        $this->info("Wrote contracts/agents/tools.json ({$tools->count()} tools).");

        return self::SUCCESS;
    }
}
