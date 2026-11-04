<?php

declare(strict_types=1);

namespace App\Domain\Firmware\Services;

use Illuminate\Validation\ValidationException;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use RuntimeException;

/**
 * Composes a firmware starter (spec 027 starter layout) from a target, a role and published
 * profile revisions. Pure: no database, no authorization and no credentials, so the API
 * and the CI fixtures command build identical starters.
 */
final class StarterBuilder
{
    public const REPLACEABLE = ['sdk/', 'generated/', '.iotos/', 'AGENTS.md', 'CLAUDE.md'];

    /** What a starter's sdk/ holds: no tests, tools or other boards' examples. */
    private const SDK_PATHS = [
        'CHANGELOG.md', 'CMakeLists.txt', 'LICENSE', 'README.md', 'THIRD_PARTY.md', 'VERSION',
        'cmake', 'examples/desktop-simulator', 'include', 'ports', 'src', 'starter', 'third_party',
    ];

    private const SDK_EXCLUDED = ['examples/desktop-simulator/sample-config/'];

    public function __construct(
        private readonly TargetRegistry $registry,
        private readonly MetricTables $tables,
        private readonly MetricHistory $history,
        private readonly FieldStubs $stubs,
        private readonly ?string $contractsPath = null,
    ) {}

    /**
     * @param  array  $target  an available registry entry
     * @param  array{artifact_uuid: string, revisions: list<array{revision: int, definition: array}>}|null  $node  the profile whose last listed revision is built; null for a gateway using the SDK's default health table
     * @param  list<array{artifact_uuid: string, revisions: list<array{revision: int, definition: array}>}>  $deviceTypes  gateway only
     * @return array{root: string, files: array<string, string>, manifest: array}
     */
    public function build(array $target, string $role, ?array $node, array $deviceTypes, ?string $generatedAt = null): array
    {
        $gateway = $role === 'gateway';
        $this->check($target, $role, $node, $deviceTypes);
        $profiles = [...($node ? [$this->profile($node)] : []), ...array_map(fn (array $type): array => $this->profile($type), $deviceTypes)];
        $codes = array_column($profiles, 'code');
        if (count(array_unique($codes)) !== count($codes)) {
            throw ValidationException::withMessages(['device_type_artifact_uuids' => 'Each profile can appear only once in a starter.']);
        }
        $identifiers = $this->tables->identifiers($codes, $node ? [] : ['gateway_health']);
        foreach ($profiles as $index => $profile) {
            $profiles[$index]['c_identifier'] = $identifiers[$index];
        }
        $nodeType = $node ? [...$profiles[0], 'is_node' => true] : $this->defaultHealth();
        $types = $node ? array_slice($profiles, 1) : $profiles;
        foreach ([$nodeType, ...$types] as $type) {
            if (count($type['metrics']) > MetricTables::MAX_METRICS) {
                throw ValidationException::withMessages([$type === $nodeType ? 'node_artifact_uuid' : 'device_type_artifact_uuids' => sprintf(
                    '%s has %d reported metrics; a device type holds at most %d (IOTOS_MAX_METRICS_PER_TYPE). Raise IOTOS_MAX_METRICS_PER_TYPE when building, or report fewer parameters.',
                    $type['name'], count($type['metrics']), MetricTables::MAX_METRICS)]);
            }
        }

        $developer = $target['developer_paths'][0];
        $rootCode = $gateway ? $types[0]['code'] : $nodeType['code'];
        $root = $rootCode.'-'.$target['id'].'-starter';
        $manifest = $this->manifest($target, $role, $nodeType, $types, $generatedAt);
        $facts = $this->facts($target, $gateway, $nodeType, $types, $developer, $root);

        $files = $this->sdkFiles();
        foreach ($this->tables->files($nodeType, $types, $gateway) as $path => $contents) {
            $files['generated/'.$path] = $contents;
        }
        $files['.iotos/device-brief.schema.json'] = $this->read($this->contracts().'/firmware/v1/device-brief.schema.json');
        $files['.iotos/porting.md'] = $this->read($this->starters().'/templates/porting.md');
        if ($target['kind'] === 'built') {
            foreach ($this->exampleFiles($target) as $path => $contents) {
                $files[$path] = $contents;
            }
        } else {
            if ($target['family_notes'] !== null) {
                $files['.iotos/family.md'] = $this->read($this->starters().'/'.$target['family_notes']);
            }
            $files['.iotos/reference/main.c'] = $this->read($this->registry->root().'/sdk/examples/linux-app/app/main.c');
            foreach ($this->directory($this->registry->root().'/sdk/ports/templates') as $path => $contents) {
                $files[$developer.'ports/'.$path] = $contents;
            }
        }
        foreach ($this->stubs->files($nodeType, $types, $gateway) as $path => $contents) {
            $files[$developer.$path] = $contents;
        }
        $files['README.md'] = $this->render('README.md.tmpl', $facts);
        $files['AGENTS.md'] = $this->render('AGENTS.md.tmpl', $facts);
        $files['CLAUDE.md'] = $this->read($this->starters().'/templates/CLAUDE.md.tmpl');
        $files['.gitignore'] = $this->render('gitignore.tmpl', $facts);
        $files['config/README.md'] = $this->read($this->starters().'/templates/config-README.md');
        $files['iotos-starter.json'] = $this->json($manifest);
        ksort($files, SORT_STRING);

        return ['root' => $root, 'files' => $files, 'manifest' => $manifest];
    }

    public function sdkVersion(): string
    {
        return trim($this->read($this->registry->root().'/sdk/VERSION'));
    }

    /** The config/README.md that starters and connection settings share. */
    public function configReadme(): string
    {
        return $this->read($this->starters().'/templates/config-README.md');
    }

    public function json(array $value): string
    {
        return json_encode($value, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)."\n";
    }

    private function check(array $target, string $role, ?array $node, array $deviceTypes): void
    {
        if (! in_array($role, $target['roles'], true)) {
            throw ValidationException::withMessages(['role' => $target['name'].' does not support the '.$role.' role.']);
        }
        if ($role === 'direct' && ($node === null || $deviceTypes !== [])) {
            throw ValidationException::withMessages(['node_artifact_uuid' => 'A direct device needs its own profile and no device types.']);
        }
        if ($role === 'gateway' && ($deviceTypes === [] || count($deviceTypes) > MetricTables::MAX_TYPES)) {
            throw ValidationException::withMessages(['device_type_artifact_uuids' => sprintf(
                'A gateway starter needs 1 to %d device types (IOTOS_MAX_DEVICE_TYPES). Raise IOTOS_MAX_DEVICE_TYPES when building to go beyond %1$d.', MetricTables::MAX_TYPES)]);
        }
    }

    /** A profile's last listed revision as a type, with its history. */
    private function profile(array $input): array
    {
        $revisions = $input['revisions'];
        usort($revisions, fn (array $a, array $b): int => $a['revision'] <=> $b['revision']);
        $definition = end($revisions)['definition'];

        return [
            'code' => (string) $definition['profile']['code'],
            'name' => (string) $definition['profile']['name'],
            'revision' => (int) $definition['profile']['revision'],
            'artifact_uuid' => $input['artifact_uuid'],
            'metrics' => $this->tables->metrics($definition),
            'history' => $this->history->of($revisions),
            'default_health' => false,
        ];
    }

    private function defaultHealth(): array
    {
        return [
            'code' => 'gateway-health', 'c_identifier' => 'gateway_health', 'name' => 'Gateway health', 'revision' => 1,
            'artifact_uuid' => null, 'metrics' => $this->tables->healthMetrics(), 'history' => null, 'default_health' => true, 'is_node' => true,
        ];
    }

    private function manifest(array $target, string $role, array $node, array $types, ?string $generatedAt): array
    {
        $profiles = array_values(array_filter([$node, ...$types], fn (array $type): bool => ! $type['default_health']));
        $metrics = $retired = [];
        foreach ($profiles as $profile) {
            $metrics[$profile['code']] = $profile['history']['metrics'];
            $retired[$profile['code']] = $profile['history']['retired'];
        }
        $warnings = [];
        foreach ([$node, ...$types] as $type) {
            $bytes = $this->tables->birthBytes($type['metrics']);
            if ($bytes > MetricTables::TX_BUFFER) {
                $warnings[] = [
                    'code' => 'birth_over_tx_buffer',
                    'message' => sprintf('A birth of %s can reach about %d bytes, more than the default IOTOS_TX_BUFFER of %d. Raise IOTOS_TX_BUFFER when building, or the SDK refuses the birth.', $type['name'], $bytes, MetricTables::TX_BUFFER),
                    'subject' => $type['code'],
                ];
            }
        }

        return [
            'format' => 1,
            'sdk_version' => $this->sdkVersion(),
            'target' => ['id' => $target['id'], 'kind' => $target['kind'], 'name' => $target['name']],
            'role' => $role,
            'generated_at' => $generatedAt ?? now()->utc()->format('Y-m-d\TH:i:s\Z'),
            'node' => $node['default_health']
                ? ['default_health' => true, 'c_identifier' => 'gateway_health']
                : ['default_health' => false, 'code' => $node['code'], 'c_identifier' => $node['c_identifier'], 'name' => $node['name'], 'revision' => $node['revision'], 'artifact_uuid' => $node['artifact_uuid']],
            'device_types' => array_map(fn (array $type): array => [
                'code' => $type['code'], 'c_identifier' => $type['c_identifier'], 'name' => $type['name'], 'revision' => $type['revision'], 'artifact_uuid' => $type['artifact_uuid'],
            ], $types),
            'metrics' => $metrics === [] ? new \stdClass : $metrics,
            'retired' => $retired === [] ? new \stdClass : $retired,
            'replaceable' => self::REPLACEABLE,
            'developer_paths' => $target['developer_paths'],
            'warnings' => $warnings,
        ];
    }

    /** The values the templates may use: starter facts only, never settings. */
    private function facts(array $target, bool $gateway, array $node, array $types, string $developer, string $root): array
    {
        $built = $target['kind'] === 'built';
        $profiles = [];
        $describe = fn (array $type): string => $type['name'].' (`'.$type['code'].'`), revision '.$type['revision'].', '.count($type['metrics']).' metrics, in `generated/profiles/'.$type['code'].'.json`';
        if ($gateway) {
            $profiles[] = '- **This gateway\'s own metrics**: '.($node['default_health'] ? 'the SDK\'s default health table, filled by the SDK.' : $describe($node).'. The SDK fills the standard health metrics.');
            foreach ($types as $type) {
                $profiles[] = '- **Device type**: '.$describe($type).'.';
            }
        } else {
            $profiles[] = '- **This device**: '.$describe($node).'.';
        }
        $family = ($target['family_notes'] ?? null) !== null ? ' and `.iotos/family.md`' : '';

        return [
            'title' => ($gateway ? $types[0]['name'].' gateway' : $node['name']).' firmware starter for '.$target['name'],
            'root' => $root,
            'target_name' => $target['name'],
            'role_text' => $gateway ? 'a gateway that publishes the devices behind it' : 'a device that connects directly and publishes its own metrics',
            'role_word' => $gateway ? 'a gateway' : 'a direct device',
            'sdk_version' => $this->sdkVersion(),
            'project_text' => $built ? 'a project that builds with '.$target['toolchain'] : 'port templates for a coding agent to fill',
            'profiles_list' => "The profiles in this starter:\n\n".implode("\n", $profiles),
            'developer_path' => $developer,
            'build_section' => $built
                ? "```sh\n".$target['build']."\n".$target['run']."\n```\n\n".(isset($target['build_notes']) ? $target['build_notes']."\n\n" : '').'Tested with '.$target['toolchain'].'.'
                : $target['name'].' has no tested project yet. The coding agent sets one up for your toolchain and fills the ports in `'.$developer.'ports/`, following `.iotos/porting.md`'.$family.'.',
            'build_command' => $built ? '`'.$target['build'].'`' : 'the build set up in step 6',
            'settings_section' => $gateway
                ? 'On the gateway\'s page in IoT OS, open **Firmware** and choose **Download settings**.'
                : 'On the device\'s page in IoT OS, choose **Firmware**, then **Download settings**.',
            'simulator_args' => $gateway ? ' --devices '.$types[0]['code'].'=10' : '',
            'developer_extra' => $built ? ', `main.c` runs the SDK, and `device-brief.yaml` records the hardware' : ', `'.$developer.'ports/` connects the SDK to the board, and `device-brief.yaml` records the hardware',
            'project_files' => $built ? $this->projectFileList($target) : '',
            'project_files_text' => $built ? ', build files' : '',
            'replaceable' => implode(' ', self::REPLACEABLE),
            'gitignore_extra' => implode("\n", $target['gitignore_extra'] ?? []),
            'hardware_note' => $built ? ' This starter is already set up for '.$target['name'].': confirm the board and its peripherals, and skip the questions about porting.' : '',
            'gateway_note' => $gateway ? ', and how each device\'s ID is formed (unique on this gateway, at most 24 characters)' : '',
            'devices_note' => $gateway
                ? '`field_devices` in `field.c` lists each device behind the gateway, from the brief\'s addressing: its ID and its profile\'s code;'
                : '`field_devices` stays empty: a direct device publishes its own metrics;',
            'port_section' => $built
                ? 'This target\'s ports are built and tested, so there is nothing to port: skip this step. Change the build files only when the developer asks.'
                : implode("\n", [
                    $target['name'].' has no tested port yet, so write it before the field side:',
                    '',
                    '1. Read `.iotos/porting.md`'.$family.', and agree the plan with the developer.',
                    '2. Fill the templates in `'.$developer.'ports/` for the board\'s network, TLS, clock, flash and RTOS.',
                    '3. Write `'.$developer.'main.c` following `.iotos/reference/main.c`, which shows how a program runs the SDK, and set up the build as `.iotos/porting.md` describes.',
                    '4. Check the port against the platform as `.iotos/porting.md` describes: connect, then the birth, then a command.',
                ]),
        ];
    }

    /** The example's files and folders at the root, outside the developer paths. */
    private function projectFileList(array $target): string
    {
        $paths = [];
        foreach (array_keys($this->exampleFiles($target)) as $path) {
            $top = str_contains($path, '/') ? strstr($path, '/', true).'/' : $path;
            if (! in_array($top, $target['developer_paths'], true)) {
                $paths[$top] = true;
            }
        }

        return implode('', array_map(fn (string $path): string => ', `'.$path.'`', array_keys($paths)));
    }

    private function render(string $template, array $facts): string
    {
        $text = preg_replace_callback('/\{\{([a-z_]+)\}\}/', function (array $match) use ($facts, $template): string {
            if (! array_key_exists($match[1], $facts)) {
                throw new RuntimeException("Template {$template} uses an unknown placeholder {$match[1]}.");
            }

            return $facts[$match[1]];
        }, $this->read($this->starters().'/templates/'.$template));

        return rtrim((string) $text, "\n")."\n";
    }

    /** @return array<string, string> */
    private function sdkFiles(): array
    {
        $root = $this->registry->root().'/sdk';
        $files = [];
        foreach (self::SDK_PATHS as $path) {
            if (is_file($root.'/'.$path)) {
                $files['sdk/'.$path] = $this->read($root.'/'.$path);

                continue;
            }
            foreach ($this->directory($root.'/'.$path) as $relative => $contents) {
                $full = $path.'/'.$relative;
                if (array_filter(self::SDK_EXCLUDED, fn (string $excluded): bool => str_starts_with($full, $excluded)) === []) {
                    $files['sdk/'.$full] = $contents;
                }
            }
        }

        return $files;
    }

    /**
     * A built target's example: project files at the root, the developer path's files
     * (except the field files, which are generated) under that path.
     *
     * @return array<string, string>
     */
    private function exampleFiles(array $target): array
    {
        $files = [];
        foreach ($this->directory($this->registry->root().'/sdk/examples/'.$target['example']) as $path => $contents) {
            $developer = array_filter($target['developer_paths'], fn (string $prefix): bool => str_starts_with($path, $prefix));
            if ($developer !== [] && in_array(basename($path), ['field.c', 'field.h', 'device-brief.example.yaml'], true)) {
                continue;
            }
            $files[$path] = $contents;
        }

        return $files;
    }

    /** @return array<string, string> relative path => contents, sorted, without hidden files */
    private function directory(string $directory): array
    {
        if (! is_dir($directory)) {
            throw new RuntimeException("The firmware sources are missing {$directory}.");
        }
        $files = [];
        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($directory, RecursiveDirectoryIterator::SKIP_DOTS));
        foreach ($iterator as $file) {
            $relative = substr($file->getPathname(), strlen($directory) + 1);
            if ($file->isFile() && ! preg_match('#(^|/)\.#', $relative)) {
                $files[str_replace(DIRECTORY_SEPARATOR, '/', $relative)] = $this->read($file->getPathname());
            }
        }
        ksort($files, SORT_STRING);

        return $files;
    }

    private function read(string $path): string
    {
        $contents = is_file($path) ? file_get_contents($path) : false;
        if ($contents === false) {
            throw new RuntimeException("The firmware sources are missing {$path}.");
        }

        return $contents;
    }

    private function starters(): string
    {
        return $this->registry->root().'/starters';
    }

    private function contracts(): string
    {
        return rtrim($this->contractsPath ?? (string) config('devices.contracts_path'), '/');
    }
}
