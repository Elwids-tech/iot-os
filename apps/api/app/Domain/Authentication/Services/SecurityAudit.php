<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Services;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Authentication\Notifications\SecurityChanged;
use App\Domain\Shared\Models\User;

/**
 * Records a change to a person's sign-in security and tells them (spec 034, FR-027,
 * FR-028). The activity entry belongs to no organization, its subject is the person,
 * and it never holds a code, a secret or credential material.
 */
final class SecurityAudit
{
    /**
     * @param  string  $event  one of the {@see SecurityChanged} event codes
     * @param  User|null  $actor  the person themself, an administrator, or null for the server
     * @param  array{remaining?: int, name?: string, reason?: string, source?: string, passkeys_removed?: int}  $details
     */
    public function record(User $person, string $event, ?User $actor, array $details = []): void
    {
        ActivityLog::record($event, null, $actor, $person, $details);

        $person->notify(new SecurityChanged($event, array_intersect_key($details, array_flip(['remaining', 'name', 'source']))));
    }
}
