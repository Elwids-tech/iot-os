<?php

declare(strict_types=1);

namespace App\Domain\Audit\Services;

/**
 * One changed field of an event: its old and new value as text, or as a list for
 * lists such as roles and permissions. An opaque change only says the field changed.
 */
final readonly class ActivityChange
{
    /**
     * @param  string|list<string>|null  $from
     * @param  string|list<string>|null  $to
     */
    public function __construct(
        public string $field,
        public string|array|null $from,
        public string|array|null $to,
        public bool $opaque = false,
    ) {}
}
