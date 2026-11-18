<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Actions;

use App\Domain\Authentication\Models\KeptSignIn;
use App\Domain\Authentication\Notifications\SecurityChanged;
use App\Domain\Authentication\Services\EndSignIns;
use App\Domain\Authentication\Services\SecurityAudit;
use App\Domain\Shared\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Laravel\Fortify\Actions\DisableTwoFactorAuthentication;

/**
 * Resets a locked-out person's two-step sign-in (spec 034, FR-024 to FR-026, ADR-048):
 * their authenticator, recovery codes and passkeys are removed and every sign-in of
 * theirs ends. A platform administrator does it from the admin app, the server operator
 * from the command line; nobody resets themselves, and only a super administrator
 * resets a super administrator.
 */
final class ResetTwoStep
{
    public const ADMIN = 'admin';

    public const CONSOLE = 'console';

    public function __construct(
        private readonly DisableTwoFactorAuthentication $disable,
        private readonly EndSignIns $endSignIns,
        private readonly SecurityAudit $audit,
    ) {}

    /**
     * @param  User|null  $actor  the administrator, or null for the server operator
     * @param  self::ADMIN|self::CONSOLE  $source
     * @return int the number of passkeys removed
     *
     * @throws AuthorizationException when the actor may not reset this person
     */
    public function __invoke(User $person, ?User $actor, string $reason, string $source, ?Request $request = null): int
    {
        if ($actor !== null && $actor->is($person)) {
            throw new AuthorizationException('You cannot reset your own two-step sign-in.');
        }
        if ($person->is_super_admin && $actor !== null && ! $actor->is_super_admin) {
            throw new AuthorizationException('Only a super administrator can reset the two-step sign-in of a super administrator.');
        }

        return DB::transaction(function () use ($person, $actor, $reason, $source, $request): int {
            ($this->disable)($person);
            $passkeys = $this->removePasskeys($person);
            $this->endSignIns->everywhere($person, KeptSignIn::TWO_STEP_RESET, $request);
            $this->audit->record($person, SecurityChanged::TWO_STEP_RESET, $actor, [
                'reason' => $reason,
                'source' => $source,
                'passkeys_removed' => $passkeys,
            ]);

            return $passkeys;
        });
    }

    /**
     * Passkeys arrive with spec 034 pull request 4; until its table exists there are
     * none to remove.
     */
    private function removePasskeys(User $person): int
    {
        return DB::table('passkeys')->where('user_id', $person->getKey())->delete();
    }
}
