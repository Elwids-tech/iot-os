<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Firmware;

use App\Domain\Firmware\Services\FixtureStarters;
use App\Domain\Firmware\Services\TargetRegistry;
use Opis\JsonSchema\Validator;
use Symfony\Component\Yaml\Yaml;
use Tests\TestCase;

/**
 * The AI brief stays in step with the starter it ships in (spec 027 contracts/device-brief.md):
 * its sections, the paths and SDK names it mentions, and the files it tells the agent to use.
 */
final class AgentsBriefDriftTest extends TestCase
{
    private const SECTIONS = [
        '1. What this project is', '2. Rules', '3. Already known: do not ask', '4. Interview', '5. Device brief',
        '6. Port', '7. Field side', '8. Verify', '9. Later changes',
    ];

    /** Files the developer, the agent or the settings download create later. */
    private const CREATED_LATER = ['app/device-brief.yaml', 'main/device-brief.yaml', 'config/iotos_settings.c', 'config/iotos_settings.h'];

    public function test_every_starter_brief_matches_its_starter(): void
    {
        $declared = $this->declaredIdentifiers();
        $starters = app(FixtureStarters::class)->starters();
        $this->assertNotEmpty($starters);
        foreach ($starters as $item) {
            $files = $item['starter']['files'];
            $label = $item['target'].'/'.$item['name'];
            preg_match_all('/^## (.+)$/m', $files['AGENTS.md'], $headings);
            $this->assertSame(self::SECTIONS, $headings[1], $label);
            $this->assertSame("@AGENTS.md\n", $files['CLAUDE.md'], $label);
            $developer = $item['starter']['manifest']['developer_paths'][0];
            $target = app(TargetRegistry::class)->find($item['target']);
            if ($target['kind'] === 'built') {
                $this->assertStringNotContainsString('## 6. Port'."\n\n".'1.', $files['AGENTS.md'], $label.': built targets skip the port');
                // The brief and the README give this target's own build, and name its developer path.
                $this->assertStringContainsString('Build with `'.$target['build'].'`.', $files['AGENTS.md'], $label);
                $this->assertStringContainsString("```sh\n".$target['build']."\n".$target['run']."\n```", $files['README.md'], $label);
                $this->assertStringContainsString('- `'.$developer.'`: the code you work on. `main.c` runs the SDK', $files['AGENTS.md'], $label);
                $this->assertArrayHasKey($developer.'main.c', $files, $label);
            }
            foreach (['AGENTS.md', 'README.md'] as $document) {
                foreach ($this->mentions($files[$document]) as $mention) {
                    if (preg_match('/^iotos_[a-z0-9_]+$/', $mention)) {
                        $this->assertTrue($this->declares($declared, $mention), "{$label} {$document} names {$mention}, which sdk/include/iotos/ does not declare");
                    } elseif ($this->isPath($mention)) {
                        // A bare file name is at the root or in the developer path; an AI-assisted target's agent writes main.c itself.
                        $paths = str_contains($mention, '/') ? [$mention] : [$mention, $developer.$mention];
                        $later = [...self::CREATED_LATER, ...($item['starter']['manifest']['target']['kind'] === 'ai_assisted' ? [$developer.'main.c'] : [])];
                        $found = array_filter($paths, fn (string $path): bool => in_array($path, $later, true) || $this->exists($files, $path));
                        $this->assertNotEmpty($found, "{$label} {$document} names {$mention}, which the starter does not have");
                    }
                }
                $this->assertStringNotContainsString('BEGIN CERTIFICATE', $files[$document]);
            }
            $this->assertStringContainsString('Read AGENTS.md and follow it. Start with the interview.', $files['README.md']);
            foreach ($item['starter']['manifest']['replaceable'] as $path) {
                $this->assertStringContainsString(' '.$path, $files['README.md'], "{$label} README update recipe names {$path}");
            }
            $this->assertValid('device-brief', Yaml::parse($files[$developer.'device-brief.example.yaml']), $label.' example brief');
            $this->assertValid('starter-manifest', $item['starter']['manifest'], $label.' manifest');
        }
    }

    /** Inline code spans outside fenced blocks. */
    private function mentions(string $markdown): array
    {
        preg_match_all('/`([^`\n]+)`/', (string) preg_replace('/^```.*?^```/ms', '', $markdown), $matches);

        return array_unique($matches[1]);
    }

    private function isPath(string $text): bool
    {
        return ! preg_match('/[\s<>*{}]/', $text) && (str_contains($text, '/') || preg_match('/\.(md|c|h|json|yaml|txt)$/', $text));
    }

    private function exists(array $files, string $path): bool
    {
        $directory = rtrim($path, '/').'/';

        return isset($files[$path]) || array_filter(array_keys($files), fn (string $file): bool => str_starts_with($file, $directory)) !== [];
    }

    /** @return list<string> */
    private function declaredIdentifiers(): array
    {
        $source = implode("\n", array_map('file_get_contents', glob(base_path('../../firmware/sdk/include/iotos/*.h'))));
        preg_match_all('/\b(iotos_[a-z0-9_]+)\b/', $source, $matches);

        return array_values(array_unique($matches[1]));
    }

    /** A name, or a prefix such as iotos_put_ that stands for a family of calls. */
    private function declares(array $declared, string $name): bool
    {
        return str_ends_with($name, '_')
            ? array_filter($declared, fn (string $identifier): bool => str_starts_with($identifier, $name)) !== []
            : in_array($name, $declared, true);
    }

    private function assertValid(string $schema, mixed $instance, string $label): void
    {
        $validator = new Validator;
        $path = base_path('../../contracts/firmware/v1/'.$schema.'.schema.json');
        $validator->resolver()->registerFile('https://iot-os.local/contracts/firmware/v1/'.$schema.'.schema.json', $path);
        $result = $validator->validate(json_decode(json_encode($instance, JSON_THROW_ON_ERROR)), 'https://iot-os.local/contracts/firmware/v1/'.$schema.'.schema.json');
        $this->assertTrue($result->isValid(), $label.': '.json_encode($result->error()?->args()).' '.$result->error()?->message().' at '.implode('/', $result->error()?->data()->fullPath() ?? []));
    }
}
