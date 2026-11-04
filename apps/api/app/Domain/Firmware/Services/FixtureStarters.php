<?php

declare(strict_types=1);

namespace App\Domain\Firmware\Services;

use RuntimeException;

/**
 * Starters and settings built from contracts/firmware/fixtures, with no database: what CI
 * builds for every target (spec 027 R16) and the golden outputs the generator is compared
 * with (R19).
 */
final class FixtureStarters
{
    /** @var array<string, array{role: string, profiles: list<string>}> */
    public const STARTERS = [
        'direct-direct-sensor' => ['role' => 'direct', 'profiles' => ['direct-sensor']],
        'direct-relay' => ['role' => 'direct', 'profiles' => ['relay']],
        'gateway-water-energy' => ['role' => 'gateway', 'profiles' => ['water-meter', 'energy-meter']],
    ];

    /** Golden starters: the case name, the target and the starter above. */
    public const GOLDEN_STARTERS = [
        'direct-relay-r2-linux' => ['target' => 'linux', 'starter' => 'direct-relay'],
        'gateway-water-energy-linux' => ['target' => 'linux', 'starter' => 'gateway-water-energy'],
    ];

    /** The developer files compared, beside generated/ and the manifest. */
    private const GOLDEN_DEVELOPER_FILES = ['field.c', 'field.h', 'device-brief.example.yaml'];

    public function __construct(
        private readonly StarterBuilder $builder,
        private readonly TargetRegistry $registry,
        private readonly ConnectionSettings $settings,
        private readonly ?string $contractsPath = null,
    ) {}

    /** A fixture profile as StarterBuilder takes it, with revisions up to $revision. */
    public function profile(string $code, ?int $revision = null): array
    {
        $path = $this->fixtures().'/profiles/'.$code.'.json';
        $fixture = is_readable($path) ? json_decode((string) file_get_contents($path), true) : null;
        if (! is_array($fixture) || ! is_array($fixture['revisions'] ?? null) || $fixture['revisions'] === []) {
            throw new RuntimeException("The fixture profile {$path} is missing or has no revisions.");
        }
        $revisions = array_values(array_filter($fixture['revisions'], fn (array $item): bool => $revision === null || $item['revision'] <= $revision));
        if ($revisions === []) {
            throw new RuntimeException("The fixture profile {$code} has no revision up to {$revision}.");
        }

        return ['artifact_uuid' => end($revisions)['artifact_uuid'], 'revisions' => $revisions];
    }

    /**
     * Every fixture starter for every available target that supports its role.
     *
     * @return list<array{target: string, name: string, starter: array}>
     */
    public function starters(?int $revision = null): array
    {
        $starters = [];
        foreach ($this->registry->available() as $target) {
            foreach (self::STARTERS as $name => $starter) {
                if (in_array($starter['role'], $target['roles'], true)) {
                    $starters[] = ['target' => $target['id'], 'name' => $name, 'starter' => $this->build($target, $starter, $revision)];
                }
            }
        }

        return $starters;
    }

    /**
     * The golden outputs (research R19): generated files of two starters, and the settings
     * files rendered from fixture credentials.
     *
     * @return array<string, array<string, string>> case => path => contents
     */
    public function golden(): array
    {
        $cases = [];
        foreach (self::GOLDEN_STARTERS as $case => $golden) {
            $target = $this->registry->find($golden['target']) ?? throw new RuntimeException("The target {$golden['target']} is not available.");
            $starter = $this->build($target, self::STARTERS[$golden['starter']], null);
            $developer = $target['developer_paths'][0];
            $files = [];
            foreach ($starter['files'] as $path => $contents) {
                if (str_starts_with($path, 'generated/') || in_array(substr($path, strlen($developer)), self::GOLDEN_DEVELOPER_FILES, true) && str_starts_with($path, $developer)) {
                    $files[$path] = $contents;
                }
            }
            $manifest = $starter['manifest'];
            unset($manifest['generated_at']);
            $files['iotos-starter.json'] = $this->builder->json($manifest);
            ksort($files, SORT_STRING);
            $cases[$case] = $files;
        }
        $ca = (string) file_get_contents($this->fixtures().'/settings/test-ca.crt');
        foreach (['direct' => false, 'gateway' => true] as $role => $gateway) {
            $files = $this->settings->render([
                'subject' => $gateway ? 'gateway "Fixture gateway"' : 'device "Fixture relay"', 'host' => 'mqtt.example.test', 'port' => 8883,
                'group_id' => 'fixture-group', 'edge_node_id' => $gateway ? 'fixture-gateway' : 'fixture-relay', 'host_id' => 'fixture-host',
                'username' => 'edge-fixture-'.$role, 'password' => 'placeholder-fixture-password-'.$role, 'ca' => $ca, 'gateway' => $gateway,
            ]);
            unset($files['config/README.md']); // the starter template, compared with the starters
            $cases['settings-'.$role] = $files;
        }

        return $cases;
    }

    public function expectedPath(): string
    {
        return $this->fixtures().'/expected';
    }

    private function build(array $target, array $starter, ?int $revision): array
    {
        $profiles = array_map(fn (string $code): array => $this->profile($code, $revision), $starter['profiles']);

        return $starter['role'] === 'direct'
            ? $this->builder->build($target, 'direct', $profiles[0], [])
            : $this->builder->build($target, 'gateway', null, $profiles);
    }

    private function fixtures(): string
    {
        return rtrim($this->contractsPath ?? (string) config('devices.contracts_path'), '/').'/firmware/fixtures';
    }
}
