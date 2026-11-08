<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

/**
 * One allowance as a manager of an organization sees it (spec 028 FR-022, spec 029
 * FR-024): `count` is the organization's own, and `account` carries the billing
 * account's allowance, what is left and the overage, without its organizations.
 */
final readonly class OrganizationUsage
{
    public function __construct(
        public int $count,
        public MonthlyUsage $account,
    ) {}
}
