<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Notifications;

use App\Domain\Shared\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * Tells a person that their sign-in security changed (spec 034, FR-027), so a change they
 * did not make is noticed. The text names what changed and never holds a code, a secret
 * or credential material. Sent after the change commits.
 */
final class SecurityChanged extends Notification implements ShouldQueue
{
    use Queueable;

    public const TWO_STEP_ENABLED = 'person.two_step_enabled';

    public const TWO_STEP_DISABLED = 'person.two_step_disabled';

    public const RECOVERY_CODES_REGENERATED = 'person.recovery_codes_regenerated';

    public const RECOVERY_CODE_USED = 'person.recovery_code_used';

    public const PASSKEY_ADDED = 'person.passkey_added';

    public const PASSKEY_REMOVED = 'person.passkey_removed';

    public const TWO_STEP_RESET = 'person.two_step_reset';

    /**
     * @param  array{remaining?: int, name?: string, source?: string}  $details
     */
    public function __construct(public readonly string $event, public readonly array $details = [])
    {
        $this->onConnection('alerts')->onQueue('alerts');
        $this->afterCommit();
    }

    /**
     * @return list<string>
     */
    public function via(User $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(User $notifiable): MailMessage
    {
        [$subject, $lines] = $this->words();
        $message = (new MailMessage)->subject($subject)->greeting('Hello '.$notifiable->name.',');
        foreach ($lines as $line) {
            $message->line($line);
        }

        return $message
            ->action('Review your security settings', rtrim((string) config('app.frontend_url'), '/').'/account/security')
            ->line('If you did not make this change, reset your password now and contact your administrator.');
    }

    /**
     * @return array{0: string, 1: list<string>}
     */
    private function words(): array
    {
        $name = isset($this->details['name']) ? '"'.$this->details['name'].'"' : 'a passkey';
        $remaining = (int) ($this->details['remaining'] ?? 0);

        return match ($this->event) {
            self::TWO_STEP_ENABLED => ['Two-step sign-in is on', ['Two-step sign-in was turned on for your account. Every sign-in now asks for a code from your authenticator app after your password.']],
            self::TWO_STEP_DISABLED => ['Two-step sign-in is off', ['Two-step sign-in was turned off for your account. Your password alone now signs you in.']],
            self::RECOVERY_CODES_REGENERATED => ['New recovery codes', ['New recovery codes were created for your account. Your earlier recovery codes no longer work.']],
            self::RECOVERY_CODE_USED => ['A recovery code was used', [
                'A recovery code was used to sign in to your account.',
                $remaining === 0
                    ? 'You have no recovery codes left. Create new ones in your security settings.'
                    : 'You have '.$remaining.' recovery '.($remaining === 1 ? 'code' : 'codes').' left.',
            ]],
            self::PASSKEY_ADDED => ['A passkey was added', ['The passkey '.$name.' was added to your account. It can now sign you in.']],
            self::PASSKEY_REMOVED => ['A passkey was removed', ['The passkey '.$name.' was removed from your account. It no longer signs you in.']],
            self::TWO_STEP_RESET => ['Your two-step sign-in was reset', [
                ($this->details['source'] ?? null) === 'console'
                    ? 'Your two-step sign-in was reset by the server operator.'
                    : 'Your two-step sign-in was reset by an administrator.',
                'Your authenticator app, recovery codes and passkeys no longer work, and you were signed out everywhere. Sign in with your password and set up two-step sign-in again.',
            ]],
            default => ['Your sign-in security changed', ['A security setting on your account changed.']],
        };
    }
}
