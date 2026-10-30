<?php

declare(strict_types=1);

namespace App\Domain\Shared\Models;

use App\Domain\Authorization\Models\PlatformRole;
use App\Domain\Billing\Models\BillingAccount;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Passport\Contracts\OAuthenticatable;
use Laravel\Passport\HasApiTokens;
use Spatie\Permission\Traits\HasRoles;

#[Fillable(['name', 'email', 'password', 'is_super_admin'])]
#[Hidden(['password', 'remember_token'])]
/**
 * People sign in to the portal with a session (Sanctum, stateful). Their AI agents
 * hold Passport tokens, so the token trait is Passport's: the two packages cannot
 * share it, and people never hold Sanctum tokens (spec 004, research finding 5).
 */
class User extends Authenticatable implements OAuthenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, HasRoles, Notifiable;

    /**
     * Roles and permissions always resolve on the web guard. Agent requests authenticate
     * on the mcp guard, which carries none, and spatie would otherwise check that one.
     */
    protected string $guard_name = 'web';

    protected static function newFactory(): UserFactory
    {
        return UserFactory::new();
    }

    /**
     * @return BelongsToMany<Organization, $this>
     */
    public function organizations(): BelongsToMany
    {
        return $this->belongsToMany(Organization::class);
    }

    /**
     * Billing accounts this person owns (spec 023). Soft-deleted accounts drop out
     * through the account's own scope. Owning an account grants no organization access.
     *
     * @return BelongsToMany<BillingAccount, $this>
     */
    public function ownedBillingAccounts(): BelongsToMany
    {
        return $this->belongsToMany(BillingAccount::class, 'billing_account_owners')
            ->withPivot(['added_by', 'created_at']);
    }

    /**
     * @return BelongsToMany<PlatformRole, $this>
     */
    public function platformRoles(): BelongsToMany
    {
        return $this->belongsToMany(PlatformRole::class, 'platform_role_user');
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'is_super_admin' => 'boolean',
        ];
    }
}
