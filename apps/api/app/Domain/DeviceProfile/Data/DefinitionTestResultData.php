<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Data;

use InvalidArgumentException;

final readonly class DefinitionTestResultData
{
    /**
     * @param  array<string, mixed>  $compiler
     * @param  list<array<string, mixed>>  $diagnostics
     * @param  list<array<string, mixed>>  $previews
     * @param  array<string, mixed>|null  $profileArtifact
     * @param  array<string, mixed>|null  $bindingArtifact
     */
    private function __construct(
        public bool $valid,
        public string $inputHash,
        public array $compiler,
        public array $diagnostics,
        public array $previews,
        public ?array $profileArtifact,
        public ?array $bindingArtifact,
        public ?string $profileArtifactHash,
        public ?string $bindingArtifactHash,
    ) {}

    /**
     * @param  array<string, mixed>  $payload
     */
    public static function fromArray(array $payload): self
    {
        if (($payload['schema'] ?? null) !== 'iot.definition-preview.v1') {
            throw new InvalidArgumentException('Unsupported definition preview schema.');
        }

        $inputHash = $payload['input_hash'] ?? null;
        $compiler = $payload['compiler'] ?? null;
        $diagnostics = $payload['diagnostics'] ?? null;
        $previews = $payload['previews'] ?? null;
        $artifactHashes = $payload['artifact_hashes'] ?? null;

        if (! is_bool($payload['valid'] ?? null) || ! is_string($inputHash) || strlen($inputHash) !== 64) {
            throw new InvalidArgumentException('Definition preview identity is incomplete.');
        }

        if (! is_array($compiler) || ! is_array($diagnostics) || ! is_array($previews) || ! is_array($artifactHashes)) {
            throw new InvalidArgumentException('Definition preview details are incomplete.');
        }

        $profileArtifact = $payload['profile_artifact'] ?? null;
        $bindingArtifact = $payload['binding_artifact'] ?? null;

        if ($profileArtifact !== null && ! is_array($profileArtifact)) {
            throw new InvalidArgumentException('The Profile artifact must be an object or null.');
        }

        if ($bindingArtifact !== null && ! is_array($bindingArtifact)) {
            throw new InvalidArgumentException('The Binding artifact must be an object or null.');
        }

        /** @var array<string, mixed> $compiler */
        /** @var list<array<string, mixed>> $diagnostics */
        /** @var list<array<string, mixed>> $previews */
        /** @var array<string, mixed>|null $profileArtifact */
        /** @var array<string, mixed>|null $bindingArtifact */
        return new self(
            valid: $payload['valid'],
            inputHash: $inputHash,
            compiler: $compiler,
            diagnostics: $diagnostics,
            previews: $previews,
            profileArtifact: $profileArtifact,
            bindingArtifact: $bindingArtifact,
            profileArtifactHash: is_string($artifactHashes['profile'] ?? null) ? $artifactHashes['profile'] : null,
            bindingArtifactHash: is_string($artifactHashes['binding'] ?? null) ? $artifactHashes['binding'] : null,
        );
    }
}
