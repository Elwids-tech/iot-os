<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Laravel\Passkeys\Passkey;
use Laravel\Passkeys\Passkeys;

/**
 * One of the person's passkeys (spec 034). The credential and its id never leave the
 * API.
 *
 * @mixin Passkey
 */
final class PasskeyResource extends JsonResource
{
    /**
     * @return array{id: int, name: string, relying_party_id: string, usable_here: bool, created_at: string|null, last_used_at: string|null}
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => (int) $this->id,
            'name' => (string) $this->name,
            // The domain the passkey was made on, and whether that is this one (spec 036, FR-026).
            'relying_party_id' => (string) $this->relying_party_id,
            'usable_here' => (string) $this->relying_party_id === strtolower(Passkeys::relyingPartyId()),
            'created_at' => $this->created_at?->toIso8601ZuluString(),
            'last_used_at' => $this->last_used_at?->toIso8601ZuluString(),
        ];
    }
}
