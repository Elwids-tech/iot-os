<?php

declare(strict_types=1);

namespace App\Domain\Firmware\Services;

use RuntimeException;

/**
 * The firmware targets in firmware/starters/targets.json (spec 027 R2). A built target is
 * offered once its example exists in the SDK copy, and a named AI-assisted one once its
 * family notes exist, so a target appears when the files that make it work arrive.
 */
final class TargetRegistry
{
    public const ROLES = ['direct', 'gateway'];

    /** @var list<array<string, mixed>>|null */
    private ?array $targets = null;

    public function __construct(private readonly ?string $root = null) {}

    public function root(): string
    {
        return rtrim($this->root ?? (string) config('firmware.path'), '/');
    }

    /**
     * Every valid entry, available or not.
     *
     * @return list<array<string, mixed>>
     */
    public function all(): array
    {
        if ($this->targets !== null) {
            return $this->targets;
        }
        $path = $this->root().'/starters/targets.json';
        $registry = is_readable($path) ? json_decode((string) file_get_contents($path), true) : null;
        if (! is_array($registry) || ($registry['format'] ?? null) !== 1 || ! is_array($registry['targets'] ?? null) || ! array_is_list($registry['targets'])) {
            throw new RuntimeException("The firmware target registry at {$path} is missing or is not format 1.");
        }
        $seen = [];
        foreach ($registry['targets'] as $index => $target) {
            $problem = $this->problem($target);
            if ($problem !== null || isset($seen[$target['id']])) {
                throw new RuntimeException('Firmware target '.$index.': '.($problem ?? 'duplicate id '.$target['id']).'.');
            }
            $seen[$target['id']] = true;
        }

        return $this->targets = $registry['targets'];
    }

    /**
     * Available targets: built first, then AI-assisted, each by `order`.
     *
     * @return list<array<string, mixed>>
     */
    public function available(): array
    {
        $targets = array_values(array_filter($this->all(), fn (array $target): bool => match ($target['kind']) {
            'built' => is_file($this->root().'/sdk/examples/'.$target['example'].'/CMakeLists.txt'),
            default => $target['family_notes'] === null || is_file($this->root().'/starters/'.$target['family_notes']),
        }));
        usort($targets, fn (array $a, array $b): int => [$a['kind'] !== 'built', $a['order'], $a['id']] <=> [$b['kind'] !== 'built', $b['order'], $b['id']]);

        return $targets;
    }

    /** @return array<string, mixed>|null */
    public function find(string $id): ?array
    {
        foreach ($this->available() as $target) {
            if ($target['id'] === $id) {
                return $target;
            }
        }

        return null;
    }

    /** The entry as `GET firmware/targets` shows it. */
    public static function view(array $target): array
    {
        return [
            'id' => $target['id'], 'name' => $target['name'], 'kind' => $target['kind'], 'roles' => $target['roles'],
            'toolchain' => $target['toolchain'] ?? null,
        ];
    }

    private function problem(mixed $target): ?string
    {
        if (! is_array($target)) {
            return 'is not an object';
        }
        if (! is_string($target['id'] ?? null) || preg_match('/^[a-z0-9-]{2,40}$/', $target['id']) !== 1) {
            return 'id must match [a-z0-9-]{2,40}';
        }
        if (! is_string($target['name'] ?? null) || $target['name'] === '') {
            return 'needs a name';
        }
        if (! in_array($target['kind'] ?? null, ['built', 'ai_assisted'], true)) {
            return 'kind must be built or ai_assisted';
        }
        $roles = $target['roles'] ?? null;
        if (! is_array($roles) || ! array_is_list($roles) || $roles === [] || array_diff($roles, self::ROLES) !== [] || count(array_unique($roles)) !== count($roles)) {
            return 'roles must be a non-empty subset of direct and gateway';
        }
        $paths = $target['developer_paths'] ?? null;
        if (! is_array($paths) || ! array_is_list($paths) || $paths === [] || array_filter($paths, fn ($path) => ! is_string($path) || preg_match('#^[a-z0-9_-]+/$#', $path) !== 1) !== []) {
            return 'developer_paths must list folders such as app/';
        }
        if (! is_int($target['order'] ?? null)) {
            return 'order must be an integer';
        }
        if ($target['kind'] === 'built') {
            if (! is_string($target['example'] ?? null) || preg_match('/^[a-z0-9-]+$/', $target['example']) !== 1 || ! is_string($target['toolchain'] ?? null) || ! is_string($target['build'] ?? null) || ! is_string($target['run'] ?? null)) {
                return 'a built target needs an example, a toolchain, a build command and a run command';
            }
            if (array_key_exists('family_notes', $target)) {
                return 'family_notes is only for AI-assisted targets';
            }
        } else {
            if (array_intersect(['example', 'toolchain', 'build', 'run'], array_keys($target)) !== []) {
                return 'example, toolchain, build and run are only for built targets';
            }
            $notes = array_key_exists('family_notes', $target) ? $target['family_notes'] : false;
            if ($notes !== null && (! is_string($notes) || preg_match('#^families/[a-z0-9-]+\.md$#', $notes) !== 1)) {
                return 'family_notes must be null or families/<name>.md';
            }
        }

        return null;
    }
}
