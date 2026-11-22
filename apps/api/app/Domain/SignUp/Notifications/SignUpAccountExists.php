<?php

declare(strict_types=1);

namespace App\Domain\SignUp\Notifications;

use App\Domain\Branding\Services\PortalLinks;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * Someone signed up with an address that already has an account (spec 035 FR-014). The
 * sign-up page answered as for a new address; this email tells the owner of the address.
 */
final class SignUpAccountExists extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct()
    {
        $this->onConnection('alerts')->onQueue('alerts')->afterCommit();
    }

    /** @return list<string> */
    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $portal = app(PortalLinks::class)->platform();

        return (new MailMessage)
            ->subject('You already have an account')
            ->line('Someone, probably you, tried to sign up with this email address. It already has an account, so nothing new was created.')
            ->action('Sign in', $portal.'/')
            ->line(sprintf('Forgot your password? Reset it at %s/forgot-password.', $portal))
            ->line('If this was not you, you can ignore this email. Your account has not changed.');
    }
}
