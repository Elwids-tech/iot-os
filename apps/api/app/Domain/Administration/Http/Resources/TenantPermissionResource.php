<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Resources;

use App\Domain\Administration\Http\Resources\Concerns\KnowsGrantablePermissions;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class TenantPermissionResource extends JsonResource
{
    use KnowsGrantablePermissions;

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'name' => $this->name,
            'group' => $this->group,
            'grantable' => $this->when($this->grantable !== null, fn (): bool => in_array($this->name, $this->grantable, true)),
        ];
    }
}
