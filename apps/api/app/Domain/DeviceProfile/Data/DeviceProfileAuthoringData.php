<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Data;

use Illuminate\Contracts\Support\Arrayable;
use InvalidArgumentException;
use JsonSerializable;

/**
 * @implements Arrayable<string, mixed>
 */
final readonly class DeviceProfileAuthoringData implements Arrayable, JsonSerializable
{
    /**
     * @param  array{uuid?: string, key: string, name: string, description?: string|null}  $profile
     * @param  array{uuid?: string, version: int, notes?: string|null, components: list<array<string, mixed>>}  $version
     */
    private function __construct(
        public array $profile,
        public array $version,
    ) {}

    /**
     * @param  array<string, mixed>  $payload
     */
    public static function fromArray(array $payload): self
    {
        if (($payload['schema'] ?? null) !== 'iot.device-profile.authoring.v1') {
            throw new InvalidArgumentException('Unsupported Device Profile authoring schema.');
        }

        $profile = $payload['profile'] ?? null;
        $version = $payload['version'] ?? null;

        if (! is_array($profile) || ! is_string($profile['key'] ?? null) || ! is_string($profile['name'] ?? null)) {
            throw new InvalidArgumentException('Device Profile metadata is incomplete.');
        }

        if (! is_array($version) || ! is_int($version['version'] ?? null) || ! is_array($version['components'] ?? null)) {
            throw new InvalidArgumentException('Device Profile Version is incomplete.');
        }

        /** @var array{uuid?: string, key: string, name: string, description?: string|null} $profile */
        /** @var array{uuid?: string, version: int, notes?: string|null, components: list<array<string, mixed>>} $version */
        return new self($profile, $version);
    }

    public function profileUuid(): ?string
    {
        return $this->profile['uuid'] ?? null;
    }

    public function profileKey(): string
    {
        return $this->profile['key'];
    }

    public function profileName(): string
    {
        return $this->profile['name'];
    }

    public function profileDescription(): ?string
    {
        return $this->profile['description'] ?? null;
    }

    public function versionUuid(): ?string
    {
        return $this->version['uuid'] ?? null;
    }

    public function versionNumber(): int
    {
        return $this->version['version'];
    }

    /**
     * @return array{uuid?: string, version: int, notes?: string|null, components: list<array<string, mixed>>}
     */
    public function versionDefinition(): array
    {
        return $this->version;
    }

    /**
     * @return array{schema: string, profile: array<string, mixed>, version: array<string, mixed>}
     */
    public function toArray(): array
    {
        return [
            'schema' => 'iot.device-profile.authoring.v1',
            'profile' => $this->profile,
            'version' => $this->version,
        ];
    }

    /**
     * @return array{schema: string, profile: array<string, mixed>, version: array<string, mixed>}
     */
    public function jsonSerialize(): array
    {
        return $this->toArray();
    }
}
