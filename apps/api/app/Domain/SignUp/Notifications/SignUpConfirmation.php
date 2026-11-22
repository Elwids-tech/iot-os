<?php

declare(strict_types=1);

namespace App\Domain\SignUp\Notifications;

use App\Domain\Branding\Services\PortalLinks;
use App\Domain\SignUp\Services\SignUps;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * The single-use link that confirms a sign-up's email (spec 035 FR-007). Sent to an
 * address, not a user: no account exists until the link is opened.
 */
final class SignUpConfirmation extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(private readonly string $name, private readonly string $token)
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
        $url = app(PortalLinks::class)->platform('sign-up/confirm').'#token='.urlencode($this->token);

        return (new MailMessage)
            ->subject('Confirm your email to finish signing up')
            ->greeting(sprintf('Hello %s,', $this->name))
            ->line('Confirm your email address to create your organization. Nothing is set up until you do.')
            ->action('Confirm my email', $url)
            ->line(sprintf('The link works once and expires in %d hours. If you did not sign up, ignore this email and nothing will be created.', SignUps::LINK_HOURS));
    }
}
