<?php

declare(strict_types=1);

namespace App\Domain\Branding\Console;

use App\Domain\Branding\Contracts\CertificateReader;
use App\Domain\Branding\Enums\PortalAddressKind;
use App\Domain\Branding\Enums\PortalAddressState;
use App\Domain\Branding\Models\PortalAddress;
use App\Domain\Branding\Services\PortalAddresses;
use Illuminate\Console\Command;

/**
 * Prints one claimed name that serves now, with what the deployment's proxy answers for
 * its certificate, as one line of JSON for the release check (spec 036, T106). Prints
 * nothing when no name serves. Reading the certificate makes the proxy issue it if it
 * has not yet, as a first visitor would.
 */
final class ServingName extends Command
{
    protected $signature = 'branding:serving-name';

    protected $description = 'Print a claimed portal name that serves, and its certificate, for the release check';

    public function handle(PortalAddresses $addresses, CertificateReader $certificates): int
    {
        if (! $addresses->enabled()) {
            return self::SUCCESS;
        }
        /** @var PortalAddress|null $name */
        $name = PortalAddress::query()
            ->with(['billingAccount.allowanceOverrides', 'billingAccount.openPlanAssignment.plan.allowances'])
            ->where('kind', PortalAddressKind::Name)
            ->where('state', PortalAddressState::Active)
            ->lazyById(200)
            ->first(fn (PortalAddress $address): bool => $address->serves());
        if ($name === null) {
            return self::SUCCESS;
        }
        $this->line((string) json_encode([
            'host' => $name->host,
            // False where the deployment has no proxy to ask: the certificate is then not checked.
            'certificate_read' => $certificates->enabled(),
            'certificate_expires_at' => $certificates->enabled() ? $certificates->expiresAt($name->host)?->toIso8601String() : null,
        ]));

        return self::SUCCESS;
    }
}
