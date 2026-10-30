<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

use Carbon\CarbonImmutable;

/**
 * One line of a billing account's history: an audited change to the account, or an
 * organization joining or leaving it. Each kind fills only its own fields.
 */
final readonly class BillingAccountHistoryEntry
{
    /**
     * @param  array{id: int, name: string}|null  $actor
     * @param  array{uuid: string, name: string}|null  $organization  organization_joined and organization_left
     * @param  array{id: int, name: string}|null  $user  owner_added and owner_removed
     * @param  list<BillingAccountChange>  $changes  updated
     */
    public function __construct(
        public CarbonImmutable $at,
        public string $action,
        public ?array $actor,
        public ?array $organization = null,
        public ?array $user = null,
        public array $changes = [],
    ) {}
}
