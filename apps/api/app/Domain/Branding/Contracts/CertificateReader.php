<?php

declare(strict_types=1);

namespace App\Domain\Branding\Contracts;

use Carbon\CarbonImmutable;

/**
 * Reads when the certificate the deployment's proxy serves for a custom domain expires
 * (spec 036, T101), so staff hear of a renewal that keeps failing before visitors do.
 * Faked in tests.
 */
interface CertificateReader
{
    /** False where there is no proxy to ask, as in development: nothing is read or recorded. */
    public function enabled(): bool;

    /** When the certificate served for the host expires. Null when none could be read. */
    public function expiresAt(string $host): ?CarbonImmutable;
}
