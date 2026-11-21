<?php

declare(strict_types=1);

namespace App\Domain\Branding\Http\Resources;

use App\Domain\Branding\Models\PortalAddress;
use App\Domain\Branding\Services\PortalAddresses;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A portal address as its owners and staff see it (spec 036, contracts/branding-api.md).
 *
 * @extends JsonResource<PortalAddress>
 */
final class PortalAddressResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var PortalAddress $address */
        $address = $this->resource;
        $addresses = app(PortalAddresses::class);
        $account = $address->billingAccount;

        return [
            'uuid' => (string) $address->uuid,
            /** @var 'name'|'domain' */
            'kind' => $address->kind->value,
            'host' => (string) $address->host,
            /** Where the portal opens on this address. */
            'url' => $addresses->url($address),
            /** @var 'waiting_dns'|'active'|'unreachable'|'suspended'|'lapsed' */
            'state' => $address->state->value,
            /** Whether links in mail and alerts use this address (FR-016). */
            'main' => (bool) ($account !== null && $addresses->mainFor($account)?->is($address)),
            'claimed_at' => $address->claimed_at?->toIso8601String(),
            'activated_at' => $address->activated_at?->toIso8601String(),
            'last_checked_at' => $address->last_checked_at?->toIso8601String(),
            'unreachable_since' => $address->unreachable_since?->toIso8601String(),
            'suspended_at' => $address->suspended_at?->toIso8601String(),
            /**
             * The DNS record that proves control of a custom domain and points it here. Null for a name.
             *
             * @var array{type: 'CNAME', name: string, value: string}|null
             */
            'record' => $addresses->record($address),
            /** When a domain still waiting for its record lapses. */
            'lapses_at' => $addresses->lapsesAt($address)?->toIso8601String(),
        ];
    }
}
