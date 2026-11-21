<?php

declare(strict_types=1);

namespace App\Domain\Branding\Contracts;

/** Looks DNS up for the custom domain check (spec 036, FR-011). Faked in tests. */
interface DnsResolver
{
    /**
     * The CNAME targets of a host, lower case and without a trailing dot. Empty when the
     * host has none or the lookup fails.
     *
     * @return list<string>
     */
    public function cnames(string $host): array;
}
