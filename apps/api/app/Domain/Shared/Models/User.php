<?php

declare(strict_types=1);

namespace App\Domain\Shared\Models;

use App\Domain\Authorization\Models\PlatformRole;
use App\Domain\Authorization\Services\PlatformAuthorization;
use App\Domain\Billing\Models\BillingAccount;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Fortify\Events\RecoveryCodeReplaced;
use Laravel\Fortify\Fortify;
use Laravel\Fortify\TwoFactorAuthenticatable;
use Laravel\Passport\Contracts\OAuthenticatable;
use Laravel\Passport\HasApiTokens;
use Spatie\Permission\Traits\HasRoles;

#[Fillable(['name', 'email', 'password', 'is_super_admin'])]
#[Hidden(['password', 'remember_token', 'two_factor_secret', 'two_factor_recovery_codes'])]
/**
 * People sign in to the portal with a session (Sanctum, stateful). Their AI agents
 * hold Passport tokens, so the token trait is Passport's: the two packages cannot
 * share it, and people never hold Sanctum tokens (spec 004, research finding 5).
 */
class User extends Authenticatable implements OAuthenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, HasRoles, Notifiable, TwoFactorAuthenticatable;

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
     * A used recovery code is removed, not replaced (spec 034, research R2): the person
     * is told how many remain and regenerates the set when they run low.
     *
     * @param  string  $code
     */
    public function replaceRecoveryCode($code): void
    {
        $remaining = array_values(array_filter(
            $this->recoveryCodes(),
            static fn (string $stored): bool => ! hash_equals($stored, (string) $code),
        ));

        $this->forceFill([
            'two_factor_recovery_codes' => Fortify::currentEncrypter()->encrypt((string) json_encode($remaining)),
        ])->save();

        RecoveryCodeReplaced::dispatch($this, $code);
    }

    public function remainingRecoveryCodes(): int
    {
        return $this->two_factor_recovery_codes === null ? 0 : count($this->recoveryCodes());
    }

    /**
     * Whether the person has a second step set up (spec 034): confirmed authenticator
     * codes. Passkeys join this with spec 034's passkeys pull request.
     */
    public function twoStepSatisfied(): bool
    {
        return $this->hasEnabledTwoFactorAuthentication();
    }

    /**
     * Who requires this person to use two-step sign-in (spec 034, FR-020, FR-021):
     * `"platform"` for super administrators and platform staff, and each organization
     * they belong to that requires it. Empty when nobody does. Read fresh on every call,
     * so a change made earlier in the same request is seen.
     *
     * @return list<'platform'|array{organization: string, name: string}>
     */
    public function twoStepRequirement(): array
    {
        $requiredBy = [];
        if ($this->is_super_admin || app(PlatformAuthorization::class)->canAccessAdministration($this)) {
            $requiredBy[] = 'platform';
        }

        $organizations = $this->organizations()
            ->where('two_step_required', true)
            ->orderBy('name')
            ->get(['organizations.id', 'organizations.uuid', 'organizations.name']);
        foreach ($organizations as $organization) {
            $requiredBy[] = ['organization' => (string) $organization->uuid, 'name' => (string) $organization->name];
        }

        return $requiredBy;
    }

    public function twoStepRequired(): bool
    {
        return $this->twoStepRequirement() !== [];
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
            'two_factor_confirmed_at' => 'datetime',
        ];
    }
}
