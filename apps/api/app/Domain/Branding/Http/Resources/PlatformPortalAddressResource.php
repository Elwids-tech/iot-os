<?php

declare(strict_types=1);

namespace App\Domain\Branding\Http\Resources;

use App\Domain\Branding\Models\PortalAddress;
use App\Domain\Branding\Services\PortalAddresses;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A portal address as platform staff see it (spec 036 US6, FR-036): what its owners
 * see, with the billing account that holds it and whether the portal answers there now.
 *
 * @extends JsonResource<PortalAddress>
 */
final class PlatformPortalAddressResource extends JsonResource
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
            /**
             * Whether the portal answers here now. False for an `active` or `unreachable`
             * address means the account's `branding` allowance, or `custom_domain` for a
             * domain, is off: the address is kept and serves again when it is back (FR-037).
             */
            'serving' => (bool) $address->serves(),
            /**
             * The billing account that holds the address. Null once that account is deleted.
             *
             * @var array{uuid: string, name: string}|null
             */
            'billing_account' => $account === null ? null : ['uuid' => (string) $account->uuid, 'name' => (string) $account->name],
            'claimed_at' => $address->claimed_at?->toIso8601String(),
            'activated_at' => $address->activated_at?->toIso8601String(),
            'last_checked_at' => $address->last_checked_at?->toIso8601String(),
            'unreachable_since' => $address->unreachable_since?->toIso8601String(),
            'suspended_at' => $address->suspended_at?->toIso8601String(),
            /**
             * The staff member who suspended it. Null unless it is suspended.
             *
             * @var int|null
             */
            'suspended_by_user_id' => $address->suspended_by,
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
