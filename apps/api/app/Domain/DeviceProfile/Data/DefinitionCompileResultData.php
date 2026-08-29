<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Data;

use Illuminate\Contracts\Support\Arrayable;
use InvalidArgumentException;
use JsonSerializable;

/** @implements Arrayable<string, mixed> */
final readonly class DefinitionCompileResultData implements Arrayable, JsonSerializable
{
    /**
     * @param  array<string, string>  $compiler
     * @param  list<array<string, mixed>>  $diagnostics
     * @param  array{profile: ?string, binding: ?string, runtime_bundle: ?string}  $artifactHashes
     * @param  array<string, mixed>|null  $profileArtifact
     * @param  array<string, mixed>|null  $bindingArtifact
     * @param  array<string, mixed>|null  $runtimeBundle
     * @param  list<array<string, mixed>>  $previews
     */
    private function __construct(
        public string $schema,
        public bool $valid,
        public string $inputHash,
        public array $compiler,
        public array $diagnostics,
        public array $artifactHashes,
        public ?array $profileArtifact,
        public ?array $bindingArtifact,
        public ?array $runtimeBundle,
        public array $previews,
    ) {}

    /** @param array<string, mixed> $payload */
    public static function fromArray(array $payload): self
    {
        self::assertAllowedKeys($payload, [
            'schema',
            'valid',
            'input_hash',
            'compiler',
            'diagnostics',
            'artifact_hashes',
            'profile_artifact',
            'binding_artifact',
            'runtime_bundle',
            'previews',
        ], 'compile result');

        if (($payload['schema'] ?? null) !== 'iot.definition-preview.v1') {
            throw new InvalidArgumentException('Unsupported definition compile result schema.');
        }
        if (! is_bool($payload['valid'] ?? null)) {
            throw new InvalidArgumentException('Compile result valid must be a boolean.');
        }

        $inputHash = self::hash($payload['input_hash'] ?? null, 'input_hash');
        $compiler = self::compiler($payload['compiler'] ?? null);
        $diagnostics = self::diagnostics($payload['diagnostics'] ?? null);
        $artifactHashes = self::artifactHashes($payload['artifact_hashes'] ?? null);
        $profileArtifact = self::optionalObject($payload, 'profile_artifact');
        $bindingArtifact = self::optionalObject($payload, 'binding_artifact');
        $runtimeBundle = self::optionalObject($payload, 'runtime_bundle');
        $previews = self::list($payload['previews'] ?? null, 'previews');

        self::assertArtifactPair($profileArtifact, $artifactHashes['profile'], 'Profile');
        self::assertArtifactPair($bindingArtifact, $artifactHashes['binding'], 'Binding');
        self::assertArtifactPair($runtimeBundle, $artifactHashes['runtime_bundle'], 'Runtime Bundle');
        self::assertArtifactSchema($profileArtifact, 'iot.device-profile.v1', 'Profile');
        self::assertArtifactSchema($bindingArtifact, 'iot.native-mqtt-binding.v1', 'Binding');
        self::assertArtifactSchema($runtimeBundle, 'iot.runtime-bundle.v1', 'Runtime Bundle');
        if ($runtimeBundle !== null && ($runtimeBundle['runtime_bundle_hash'] ?? null) !== $artifactHashes['runtime_bundle']) {
            throw new InvalidArgumentException('Compile result Runtime Bundle identity does not match artifact_hashes.runtime_bundle.');
        }
        self::previews($previews);

        return new self(
            schema: 'iot.definition-preview.v1',
            valid: $payload['valid'],
            inputHash: $inputHash,
            compiler: $compiler,
            diagnostics: $diagnostics,
            artifactHashes: $artifactHashes,
            profileArtifact: $profileArtifact,
            bindingArtifact: $bindingArtifact,
            runtimeBundle: $runtimeBundle,
            previews: $previews,
        );
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'schema' => $this->schema,
            'valid' => $this->valid,
            'input_hash' => $this->inputHash,
            'compiler' => $this->compiler,
            'diagnostics' => $this->diagnostics,
            'artifact_hashes' => $this->artifactHashes,
            'profile_artifact' => $this->profileArtifact,
            'binding_artifact' => $this->bindingArtifact,
            'runtime_bundle' => $this->runtimeBundle,
            'previews' => $this->previews,
        ];
    }

    /** @return array<string, mixed> */
    public function jsonSerialize(): array
    {
        return $this->toArray();
    }

    /** @return array<string, string> */
    private static function compiler(mixed $value): array
    {
        if (! is_array($value)) {
            throw new InvalidArgumentException('Compile result compiler must be an object.');
        }
        self::assertAllowedKeys($value, [
            'name',
            'version',
            'cel_environment',
            'jsonpath_version',
            'unit_registry',
        ], 'compiler');

        $result = [];
        foreach (['name', 'version', 'cel_environment', 'jsonpath_version', 'unit_registry'] as $key) {
            if (! is_string($value[$key] ?? null) || trim($value[$key]) === '') {
                throw new InvalidArgumentException("Compile result compiler.{$key} must be a non-empty string.");
            }
            $result[$key] = $value[$key];
        }

        return $result;
    }

    /** @return list<array<string, mixed>> */
    private static function diagnostics(mixed $value): array
    {
        $diagnostics = self::list($value, 'diagnostics');
        foreach ($diagnostics as $index => $diagnostic) {
            if (! is_array($diagnostic)) {
                throw new InvalidArgumentException("Compile result diagnostics.{$index} must be an object.");
            }
            self::assertAllowedKeys(
                $diagnostic,
                ['severity', 'code', 'path', 'message', 'suggestion'],
                "diagnostics.{$index}",
            );
            if (! in_array($diagnostic['severity'] ?? null, ['error', 'warning', 'info'], true)) {
                throw new InvalidArgumentException("Compile result diagnostics.{$index}.severity is invalid.");
            }
            foreach (['code', 'path', 'message'] as $key) {
                if (! is_string($diagnostic[$key] ?? null) || $diagnostic[$key] === '') {
                    throw new InvalidArgumentException("Compile result diagnostics.{$index}.{$key} must be a non-empty string.");
                }
            }
        }

        return $diagnostics;
    }

    /** @return array{profile: ?string, binding: ?string, runtime_bundle: ?string} */
    private static function artifactHashes(mixed $value): array
    {
        if (! is_array($value)) {
            throw new InvalidArgumentException('Compile result artifact_hashes must be an object.');
        }
        self::assertAllowedKeys($value, ['profile', 'binding', 'runtime_bundle'], 'artifact_hashes');

        $result = [];
        foreach (['profile', 'binding', 'runtime_bundle'] as $key) {
            if (! array_key_exists($key, $value)) {
                throw new InvalidArgumentException("Compile result artifact_hashes.{$key} is required.");
            }
            $result[$key] = $value[$key] === null
                ? null
                : self::hash($value[$key], "artifact_hashes.{$key}");
        }

        return $result;
    }

    /** @param array<string, mixed> $payload */
    private static function optionalObject(array $payload, string $key): ?array
    {
        if (! array_key_exists($key, $payload)) {
            return null;
        }
        if (! is_array($payload[$key])) {
            throw new InvalidArgumentException("Compile result {$key} must be an object when present.");
        }

        return $payload[$key];
    }

    /** @return list<array<string, mixed>> */
    private static function list(mixed $value, string $path): array
    {
        if (! is_array($value) || ! array_is_list($value)) {
            throw new InvalidArgumentException("Compile result {$path} must be a list.");
        }

        return $value;
    }

    private static function hash(mixed $value, string $path): string
    {
        if (! is_string($value) || preg_match('/^[a-f0-9]{64}$/', $value) !== 1) {
            throw new InvalidArgumentException("Compile result {$path} must be a lowercase SHA-256 hash.");
        }

        return $value;
    }

    private static function assertArtifactPair(?array $artifact, ?string $hash, string $name): void
    {
        if (($artifact === null) !== ($hash === null)) {
            throw new InvalidArgumentException("Compile result {$name} artifact and hash must either both be present or both be absent.");
        }
    }

    /** @param array<string, mixed>|null $artifact */
    private static function assertArtifactSchema(?array $artifact, string $schema, string $name): void
    {
        if ($artifact !== null && ($artifact['schema'] ?? null) !== $schema) {
            throw new InvalidArgumentException("Compile result {$name} artifact schema is invalid.");
        }
    }

    /** @param list<array<string, mixed>> $previews */
    private static function previews(array $previews): void
    {
        foreach ($previews as $index => $preview) {
            if (! is_array($preview)) {
                throw new InvalidArgumentException("Compile result previews.{$index} must be an object.");
            }
            foreach (['name', 'accepted', 'values', 'diagnostics'] as $key) {
                if (! array_key_exists($key, $preview)) {
                    throw new InvalidArgumentException("Compile result previews.{$index}.{$key} is required.");
                }
            }
            if (! is_string($preview['name']) || $preview['name'] === '' || ! is_bool($preview['accepted'])) {
                throw new InvalidArgumentException("Compile result previews.{$index} identity is invalid.");
            }
            self::list($preview['values'], "previews.{$index}.values");
            self::diagnostics($preview['diagnostics']);
        }
    }

    /** @param array<string, mixed> $value @param list<string> $allowed */
    private static function assertAllowedKeys(array $value, array $allowed, string $path): void
    {
        $unknown = array_values(array_diff(array_keys($value), $allowed));
        if ($unknown !== []) {
            throw new InvalidArgumentException("Compile result {$path} contains unsupported keys: ".implode(', ', $unknown).'.');
        }
    }
}
