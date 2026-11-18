<?php

declare(strict_types=1);

namespace App\Domain\SignUp\Http\Resources;

use App\Domain\SignUp\Models\SignUp;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A sign-up in the admin list (spec 035 FR-028). Never the password or the token.
 *
 * @mixin SignUp
 */
final class SignUpResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var SignUp $signUp */
        $signUp = $this->resource;
        $organization = $signUp->organization;

        return [
            'uuid' => $signUp->uuid,
            'name' => $signUp->name,
            'email' => $signUp->email,
            'organization_name' => $signUp->organization_name,
            /** `waiting`, `expired`, `completed` or `refused`. */
            'state' => $signUp->displayState(),
            /** Why a sign-up was refused: `honeypot`, `too_fast`, `form_expired`, `paused` or `account_exists`. */
            'refusal_reason' => $signUp->refusal_reason,
            /** How many confirmation links were sent. */
            'sends' => $signUp->sends,
            'created_at' => $signUp->created_at->toIso8601ZuluString(),
            'completed_at' => $signUp->completed_at?->toIso8601ZuluString(),
            /** The organization it created, while it exists. */
            'organization' => $organization === null ? null : ['uuid' => $organization->uuid, 'name' => $organization->name],
            /** The person it created, by integer id (ADR-013), while they exist. */
            'user_id' => $signUp->user_id,
            'ip_address' => $signUp->ip_address,
        ];
    }
}
