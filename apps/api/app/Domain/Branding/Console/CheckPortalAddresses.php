<?php

declare(strict_types=1);

namespace App\Domain\Branding\Console;

use App\Domain\Branding\Models\PortalAddress;
use App\Domain\Branding\Services\PortalAddresses;
use Illuminate\Console\Command;

/**
 * Looks up the DNS record of each custom domain that is due (spec 036, FR-011, FR-015):
 * every request still waiting, and every serving domain not looked at for 15 minutes.
 * Run every two minutes. Idempotent: a check only reads DNS and moves the address
 * between its states, and a request with no record lapses after seven days.
 */
final class CheckPortalAddresses extends Command
{
    protected $signature = 'branding:check-addresses';

    protected $description = 'Check the DNS records of custom portal domains';

    public function handle(PortalAddresses $addresses): int
    {
        if (! $addresses->enabled()) {
            return self::SUCCESS;
        }
        $changed = 0;
        $due = $addresses->due();
        $due->each(function (PortalAddress $address) use ($addresses, &$changed): void {
            $before = $address->state;
            $changed += $addresses->check($address)->state === $before ? 0 : 1;
        });
        $this->info(sprintf('Checked %d custom domains; %d changed state.', $due->count(), $changed));

        return self::SUCCESS;
    }
}
