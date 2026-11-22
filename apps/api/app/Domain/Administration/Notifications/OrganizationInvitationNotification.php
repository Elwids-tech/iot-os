<?php

declare(strict_types=1);

namespace App\Domain\Administration\Notifications;

use App\Domain\Administration\Models\OrganizationInvitation;
use App\Domain\Branding\Services\MailBrand;
use App\Domain\Branding\Services\PortalLinks;
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
        $path = 'accept-invitation?token='.urlencode($this->token);

        // Platform staff are invited to the platform, under its own name.
        if ($this->invitation->grants_super_admin) {
            $acceptUrl = app(PortalLinks::class)->platform($path);

            return (new MailMessage)
                ->subject('You have been invited to administer IoT OS')
                ->greeting('You have been invited to IoT OS')
                ->line('Join as a super administrator: you will manage the platform and every organization on it.')
                ->action('Accept invitation', $acceptUrl)
                ->line(sprintf('This invitation expires on %s.', $this->invitation->expires_at->toDayDateTimeString()));
        }

        $organization = $this->invitation->organization;
        $brand = MailBrand::forOrganization($organization);
        $product = $brand->or('IoT OS');

        return $brand->apply((new MailMessage)
            ->subject(sprintf('Join %s on %s', $organization->name, $product))
            ->greeting(sprintf('You have been invited to %s', $product))
            ->line(sprintf('Join %s to access its IoT workspace.', $organization->name))
            ->action('Accept invitation', app(PortalLinks::class)->forOrganization($organization, $path))
            ->line(sprintf('This invitation expires on %s.', $this->invitation->expires_at->toDayDateTimeString())));
    }
}
