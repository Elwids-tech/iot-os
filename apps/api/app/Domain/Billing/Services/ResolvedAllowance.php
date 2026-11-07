<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

use App\Domain\Billing\Enums\AllowanceKind;

/**
 * One of a billing account's allowances and where it comes from (ADR-035). `value` is
 * null for unlimited; for retention, null means the platform setting applies.
 */
final readonly class ResolvedAllowance
{
    /**
     * @param  'override'|'plan'|'default'  $source
     */
    public function __construct(
        public AllowanceKind $kind,
        public ?int $value,
        public string $source,
        public ?string $note = null,
    ) {}
}
