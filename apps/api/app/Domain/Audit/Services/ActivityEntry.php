<?php

declare(strict_types=1);

namespace App\Domain\Audit\Services;

use Carbon\CarbonImmutable;

/**
 * One event of the activity feed, with names resolved (spec 024). The actor's name and
 * email are null when the user was deleted; the subject has a kind, a UUID or a name,
 * or none of them.
 */
final readonly class ActivityEntry
{
    /**
     * @param  list<ActivityChange>  $changes
     * @param  array<string, string>  $details  what the action recorded besides its changes, as text
     */
    public function __construct(
        public int $id,
        public string $action,
        public string $summary,
        public CarbonImmutable $at,
        public int $actorId,
        public ?string $actorName,
        public ?string $actorEmail,
        public ?string $organizationUuid,
        public ?string $organizationName,
        public ?string $subjectType,
        public ?string $subjectUuid,
        public ?string $subjectName,
        public array $changes,
        public array $details,
    ) {}
}
