<?php

declare(strict_types=1);

namespace App\Domain\Agents\Mcp;

use App\Domain\Agents\Enums\AccessLevel;
use App\Domain\Agents\Models\AgentConnection;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;

/** Who an agent call acts for: one person, in one organization, at one access level. */
final readonly class AgentContext
{
    public function __construct(
        public AgentConnection $connection,
        public User $user,
        public Organization $organization,
    ) {}

    public function level(): AccessLevel
    {
        return $this->connection->access_level;
    }

    public function allows(AccessLevel $needed): bool
    {
        return $needed === AccessLevel::READ || $this->level() === AccessLevel::DRAFT;
    }
}
