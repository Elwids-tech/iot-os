<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Http\Resources;

use App\Domain\Shared\Http\Resources\OrganizationResource;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class AuthenticatedUserResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
            'email_verified_at' => $this->email_verified_at?->toIso8601String(),
            'organizations' => OrganizationResource::collection(
                $this->whenLoaded('organizations'),
            ),
        ];
    }
}
