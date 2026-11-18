<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Domain\Shared\Models\User;
use Illuminate\Support\Collection;
use Laravel\Fortify\Fortify;
use PragmaRX\Google2FA\Google2FA;

/** People with two-step sign-in on, and their current codes (spec 034). */
trait TwoStepFixtures
{
    /**
     * Turn two-step on for the person, as a confirmed setup would.
     *
     * @return array{0: string, 1: list<string>} the secret and the recovery codes
     */
    protected function turnOnTwoStep(User $user): array
    {
        $secret = (new Google2FA)->generateSecretKey();
        $codes = Collection::times(8, fn (int $n): string => sprintf('code%02d-%s', $n, bin2hex(random_bytes(4))))->all();
        $user->forceFill([
            'two_factor_secret' => Fortify::currentEncrypter()->encrypt($secret),
            'two_factor_recovery_codes' => Fortify::currentEncrypter()->encrypt((string) json_encode($codes)),
            'two_factor_confirmed_at' => now(),
        ])->save();

        return [$secret, $codes];
    }

    /**
     * The authenticator app's code for the secret, `$steps` 30-second steps from now.
     *
     * The server checks codes against the real clock (Google2FA reads `microtime()`, not
     * the test's travelled time), so codes come from the same clock. A code one step
     * ahead is a fresh code the server still accepts (its window is one step either side).
     */
    protected function totp(string $secret, int $steps = 0): string
    {
        $engine = new Google2FA;

        return $engine->oathTotp($secret, (int) floor(microtime(true) / $engine->getKeyRegeneration()) + $steps);
    }
}
