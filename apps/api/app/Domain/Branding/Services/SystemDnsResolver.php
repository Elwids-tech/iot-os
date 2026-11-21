<?php

declare(strict_types=1);

namespace App\Domain\Branding\Services;

use App\Domain\Branding\Contracts\DnsResolver;

/** The resolver of the machine the API runs on. */
final class SystemDnsResolver implements DnsResolver
{
    public function cnames(string $host): array
    {
        // A failed lookup warns; it is an empty answer here.
        $records = @dns_get_record($host, DNS_CNAME);
        if (! is_array($records)) {
            return [];
        }

        return array_values(array_filter(array_map(
            static fn (array $record): string => rtrim(strtolower((string) ($record['target'] ?? '')), '.'),
            $records,
        )));
    }
}
