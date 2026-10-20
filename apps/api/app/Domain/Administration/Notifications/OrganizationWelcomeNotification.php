<?php

declare(strict_types=1);

namespace App\Domain\Administration\Notifications;

use App\Domain\Administration\Services\OrganizationGrants;
use App\Domain\Automation\Permissions\WorkflowPermission;
use App\Domain\Dashboards\Permissions\DashboardPermission;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use App\Domain\Shared\Permissions\UserPermission;
use BackedEnum;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * Sent once a person accepts an invitation to an organization. It describes only what
 * their roles there let them do, read when the worker sends it.
 */
final class OrganizationWelcomeNotification extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(private readonly Organization $organization)
    {
        $this->onConnection('alerts')->onQueue('alerts')->afterCommit();
    }

    /**
     * @return list<string>
     */
    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    // Someone removed before the worker runs gets no welcome.
    public function shouldSend(User $notifiable, string $channel): bool
    {
        return $notifiable->organizations()->whereKey($this->organization->getKey())->exists();
    }

    public function toMail(User $notifiable): MailMessage
    {
        $held = app(OrganizationGrants::class)->heldBy($notifiable, $this->organization);
        $can = static fn (BackedEnum $permission): bool => in_array($permission->value, $held, true);
        $name = $this->organization->name;
        $homeUrl = sprintf(
            '%s/organizations/%s/home',
            rtrim((string) config('app.frontend_url'), '/'),
            $this->organization->uuid,
        );

        return (new MailMessage)
            ->subject(sprintf('Welcome to %s on IoT OS', $name))
            ->greeting(sprintf('Welcome, %s', $notifiable->name))
            ->line(sprintf('You are now a member of %s. Your role decides what you can do there; here is where to start.', $name))
            ->lineIf($can(DevicePermission::VIEW), '**Follow your devices.** **Devices** shows live readings, history and meter consumption by hour, day or month. Stale and invalid readings are marked, never shown as good data.')
            ->lineIf($can(DashboardPermission::CREATE), '**Build dashboards.** Pick the readings you care about and add a suggested panel: charts, gauges, maps, consumption bars or device controls. Share a dashboard with people or roles, or show it full screen on a wall display.')
            ->lineIf(! $can(DashboardPermission::CREATE) && $can(DashboardPermission::VIEW), '**Open dashboards.** **Dashboards** lists the ones your team has shared with you.')
            ->lineIf($can(DevicePermission::MANAGE), '**Respond to alerts.** The **Alerts** inbox shows what needs attention. Acknowledge, assign and comment so your team knows who is on it.')
            ->lineIf(! $can(DevicePermission::MANAGE) && $can(DevicePermission::VIEW), '**Keep an eye on alerts.** The **Alerts** inbox shows active conditions and their history.')
            ->lineIf($can(DevicePermission::COMMAND), '**Control devices.** Use switches, sliders and set points on a device\'s Control tab or on a dashboard. A command counts as done only when the device reports the new value, and every command is recorded.')
            ->lineIf($can(DevicePermission::MANAGE), '**Connect devices.** Describe a device type once in **Device profiles**, then add devices with the guided setup or onboard what **Discovery** finds when a gateway connects. **Integrations** gives your own systems scoped access to the data.')
            ->lineIf($can(WorkflowPermission::MANAGE), '**Automate.** Build automations in the visual editor under **Automations** and test them on simulated readings before they go live.')
            ->lineIf($can(UserPermission::CREATE), '**Invite your team.** Add colleagues and give them roles in **Settings → Members**.')
            ->line('**Get help.** Every page has a step-by-step guide behind its **Help** button, and **Support** takes bug reports and feature requests. Choose which emails reach you in **Settings → Email preferences**.')
            ->action(sprintf('Open %s', $name), $homeUrl)
            ->line(sprintf('You receive this because you accepted an invitation to %s.', $name));
    }
}
