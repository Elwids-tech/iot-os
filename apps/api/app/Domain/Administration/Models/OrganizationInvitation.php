<?php

declare(strict_types=1);

namespace App\Domain\Administration\Models;

use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * An invitation into an organization with its roles or, when `grants_super_admin` is set,
 * to become a super administrator: then it has no organization and no roles (spec 007).
 *
 * @property int|null $organization_id
 * @property bool $grants_super_admin
 * @property array<int, int> $role_ids
 * @property Carbon $expires_at
 * @property Carbon|null $accepted_at
 * @property Carbon|null $revoked_at
 */
#[Fillable([
    'uuid',
    'organization_id',
    'grants_super_admin',
    'email',
    'role_ids',
    'token_hash',
    'invited_by_user_id',
    'expires_at',
    'accepted_at',
    'revoked_at',
])]
final class OrganizationInvitation extends Model
{
    /**
     * @return BelongsTo<Organization, $this>
     */
    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function invitedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'invited_by_user_id');
    }

    public function isPending(): bool
    {
        return $this->accepted_at === null
            && $this->revoked_at === null
            && $this->expires_at->isFuture();
    }

    public function getRouteKeyName(): string
    {
        return 'uuid';
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'grants_super_admin' => 'boolean',
            'role_ids' => 'array',
            'expires_at' => 'datetime',
            'accepted_at' => 'datetime',
            'revoked_at' => 'datetime',
        ];
    }
}
