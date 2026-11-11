<?php

declare(strict_types=1);

namespace App\Domain\Devices\Data;

/**
 * What brings a device's messages in (spec 031, ADR-039): an adapter, or a gateway in one
 * of an organization's connections. A device whose pipe another organization of its
 * billing account owns is hosted.
 */
final readonly class Pipe
{
    public function __construct(
        public string $kind,
        public string $name,
        public int $ownerOrganizationId,
        public string $ownerOrganizationName,
        public bool $online,
        public bool $hosted,
        public ?int $adapterId = null,
        public ?int $gatewayId = null,
    ) {}

    /**
     * What a device's organization may see of its pipe, and nothing else of it.
     *
     * @return array{kind: string, name: string, owner_organization_name: string, online: bool, hosted: bool}
     */
    public function toArray(): array
    {
        return [
            'kind' => $this->kind,
            'name' => $this->name,
            'owner_organization_name' => $this->ownerOrganizationName,
            'online' => $this->online,
            'hosted' => $this->hosted,
        ];
    }
}
