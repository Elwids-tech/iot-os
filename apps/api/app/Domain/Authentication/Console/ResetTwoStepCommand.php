<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Console;

use App\Domain\Authentication\Actions\ResetTwoStep;
use App\Domain\Shared\Models\User;
use Illuminate\Console\Command;

/**
 * The server operator resets a locked-out person's two-step sign-in, for deployments
 * where no administrator can sign in (spec 034, FR-026). Recorded with no causer and
 * `source: console`.
 */
final class ResetTwoStepCommand extends Command
{
    protected $signature = 'auth:reset-two-step
        {email : The email address of the person who is locked out}
        {--reason= : Why the reset is done, for example how their identity was checked}';

    protected $description = 'Reset a person\'s two-step sign-in: remove their authenticator, recovery codes and passkeys and end their sign-ins';

    public function handle(ResetTwoStep $reset): int
    {
        $reason = trim((string) $this->option('reason'));
        if ($reason === '') {
            $this->error('Give a reason with --reason="…", for example how you checked their identity.');

            return self::INVALID;
        }
        if (mb_strlen($reason) > 500) {
            $this->error('The reason can be at most 500 characters.');

            return self::INVALID;
        }

        $email = trim((string) $this->argument('email'));
        $person = User::query()->whereRaw('lower(email) = ?', [mb_strtolower($email)])->first();
        if ($person === null) {
            $this->error("No person has the email address {$email}.");

            return self::FAILURE;
        }

        $passkeys = $reset($person, null, $reason, ResetTwoStep::CONSOLE);
        $this->info("Two-step sign-in reset for {$person->email}: authenticator and recovery codes removed, {$passkeys} ".($passkeys === 1 ? 'passkey' : 'passkeys').' removed, signed out everywhere. They have been emailed.');

        return self::SUCCESS;
    }
}
