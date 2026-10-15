<?php

declare(strict_types=1);

namespace App\Domain\Administration\Notifications;

use App\Domain\Administration\Models\OrganizationInvitation;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

final class OrganizationInvitationNotification extends Notification
{
    use Queueable;

    public function __construct(
        private readonly OrganizationInvitation $invitation,
        private readonly string $token,
    ) {}

    /**
     * @return list<string>
     */
    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $acceptUrl = sprintf(
            '%s/accept-invitation?token=%s',
            rtrim((string) config('app.frontend_url'), '/'),
            urlencode($this->token),
        );

        if ($this->invitation->grants_super_admin) {
            return (new MailMessage)
                ->subject('You have been invited to administer IoT OS')
                ->greeting('You have been invited to IoT OS')
                ->line('Join as a super administrator: you will manage the platform and every organization on it.')
                ->action('Accept invitation', $acceptUrl)
                ->line(sprintf('This invitation expires on %s.', $this->invitation->expires_at->toDayDateTimeString()));
        }

        return (new MailMessage)
            ->subject(sprintf('Join %s on IoT OS', $this->invitation->organization->name))
            ->greeting('You have been invited to IoT OS')
            ->line(sprintf('Join %s to access its IoT workspace.', $this->invitation->organization->name))
            ->action('Accept invitation', $acceptUrl)
            ->line(sprintf('This invitation expires on %s.', $this->invitation->expires_at->toDayDateTimeString()));
    }
}
