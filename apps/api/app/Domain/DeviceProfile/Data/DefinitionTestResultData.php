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

        if (! is_bool($payload['valid'] ?? null) || ! is_string($inputHash) || preg_match('/\A[a-f0-9]{64}\z/D', $inputHash) !== 1) {
            throw new InvalidArgumentException('Definition preview identity is incomplete.');
        }

        if (! is_array($compiler) || ! is_array($diagnostics) || ! is_array($previews) || ! is_array($artifactHashes)) {
            throw new InvalidArgumentException('Definition preview details are incomplete.');
        }

        foreach (['name', 'version', 'cel_environment', 'jsonpath_version', 'unit_registry'] as $metadataKey) {
            if (! is_string($compiler[$metadataKey] ?? null) || $compiler[$metadataKey] === '') {
                throw new InvalidArgumentException('Definition compiler metadata is incomplete.');
            }
        }

        if (! array_is_list($diagnostics) || ! array_is_list($previews)) {
            throw new InvalidArgumentException('Definition diagnostics and previews must be lists.');
        }

        foreach ([...$diagnostics, ...$previews] as $item) {
            if (! is_array($item)) {
                throw new InvalidArgumentException('Definition diagnostics and previews must contain objects.');
            }
        }

        $profileArtifact = $payload['profile_artifact'] ?? null;
        $bindingArtifact = $payload['binding_artifact'] ?? null;

        if ($profileArtifact !== null && ! is_array($profileArtifact)) {
            throw new InvalidArgumentException('The Profile artifact must be an object or null.');
        }

        if ($bindingArtifact !== null && ! is_array($bindingArtifact)) {
            throw new InvalidArgumentException('The Binding artifact must be an object or null.');
        }

        $profileArtifactHash = $artifactHashes['profile'] ?? null;
        $bindingArtifactHash = $artifactHashes['binding'] ?? null;
        foreach ([$profileArtifactHash, $bindingArtifactHash] as $artifactHash) {
            if ($artifactHash !== null && (! is_string($artifactHash) || preg_match('/\A[a-f0-9]{64}\z/D', $artifactHash) !== 1)) {
                throw new InvalidArgumentException('Definition artifact hashes must be lowercase SHA-256 values or null.');
            }
        }

        if ($payload['valid'] && ($profileArtifact === null || $bindingArtifact === null || $profileArtifactHash === null || $bindingArtifactHash === null)) {
            throw new InvalidArgumentException('A valid definition preview must include both artifacts and hashes.');
        }

        if (! $payload['valid'] && ($profileArtifact !== null || $bindingArtifact !== null || $profileArtifactHash !== null || $bindingArtifactHash !== null)) {
            throw new InvalidArgumentException('An invalid definition preview cannot include artifacts or hashes.');
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
            profileArtifactHash: $profileArtifactHash,
            bindingArtifactHash: $bindingArtifactHash,
        );
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'schema' => 'iot.definition-preview.v1',
            'valid' => $this->valid,
            'input_hash' => $this->inputHash,
            'compiler' => $this->compiler,
            'diagnostics' => $this->diagnostics,
            'profile_artifact' => $this->profileArtifact,
            'binding_artifact' => $this->bindingArtifact,
            'artifact_hashes' => [
                'profile' => $this->profileArtifactHash,
                'binding' => $this->bindingArtifactHash,
            ],
            'previews' => $this->previews,
        ];
    }
}
