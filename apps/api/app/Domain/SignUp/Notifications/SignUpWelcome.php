<?php

declare(strict_types=1);

namespace App\Domain\SignUp\Notifications;

use App\Domain\Branding\Services\PortalLinks;
use App\Domain\Shared\Models\Organization;
use App\Domain\SignUp\Services\SignUpSettings;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * Sent once a sign-up has created its organization (spec 035 FR-019): where to start,
 * and what the beta means while the deployment is marked as a free beta.
 */
final class SignUpWelcome extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(private readonly Organization $organization)
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
        $name = $this->organization->name;
        $freeBeta = app(SignUpSettings::class)->get()['free_beta'];

        return (new MailMessage)
            ->subject(sprintf('%s is ready', $name))
            ->greeting(sprintf('Welcome, %s', $notifiable->name ?? ''))
            ->line(sprintf('Your organization %s is ready, and you are its administrator.', $name))
            ->line('**Connect your first device.** Open **Devices → Add device** and follow the steps. Readings appear as soon as the device reports.')
            ->line('**Invite your team.** Add colleagues and give them roles in **Settings → Members**.')
            ->line('**Get help.** Every page has a step-by-step guide behind its **Help** button.')
            ->lineIf($freeBeta, '**Free during the beta.** Nothing is charged and no card is needed. Plans will later set limits on devices, stored readings, history, alerts and SMS, and you will hear from us before anything is charged.')
            ->lineIf(! $freeBeta, '**Plans.** Your account starts without a plan. We will agree a plan with you before anything is charged.')
            ->action(sprintf('Open %s', $name), app(PortalLinks::class)->forOrganization($this->organization, sprintf('organizations/%s/home', $this->organization->uuid)))
            ->line('You receive this because you signed up with this email address.');
    }
}
