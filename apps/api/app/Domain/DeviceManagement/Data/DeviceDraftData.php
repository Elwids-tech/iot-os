<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Data;

use Illuminate\Contracts\Support\Arrayable;
use InvalidArgumentException;

/**
 * @implements Arrayable<string, string|null>
 */
final readonly class DeviceDraftData implements Arrayable
{
    private function __construct(
        public string $name,
        public string $externalId,
        public ?string $description,
    ) {}

    /**
     * @param  array<string, mixed>  $payload
     */
    public static function fromArray(array $payload): self
    {
        $name = $payload['name'] ?? null;
        $externalId = $payload['external_id'] ?? null;
        $description = $payload['description'] ?? null;

        if (! is_string($name) || trim($name) === '') {
            throw new InvalidArgumentException('A Device name is required.');
        }

        if (! is_string($externalId) || trim($externalId) === '') {
            throw new InvalidArgumentException('A Device external ID is required.');
        }

        if ($description !== null && ! is_string($description)) {
            throw new InvalidArgumentException('A Device description must be a string or null.');
        }

        return new self(trim($name), trim($externalId), $description);
    }

    /**
     * @return array{name: string, external_id: string, description: string|null}
     */
    public function toArray(): array
    {
        return [
            'name' => $this->name,
            'external_id' => $this->externalId,
            'description' => $this->description,
        ];
    }
}
