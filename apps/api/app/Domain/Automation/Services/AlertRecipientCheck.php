<?php

declare(strict_types=1);

namespace App\Domain\Automation\Services;

use App\Domain\Automation\Models\Alert;
use App\Domain\Automation\Models\AlertDelivery;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Notifications\Models\PushDevice;
use App\Domain\Notifications\Services\Preferences;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;

/**
 * The checks every channel repeats before each send (spec 011 FR-008, spec 033 FR-025):
 * the alert is an automation alert, the recipient is still a verified member who can
 * view devices, their preferences allow this channel and level, the automation still
 * names them, its execution has not stopped or been replaced, and an activation has not
 * already cleared. Only the preference check differs by channel.
 */
final class AlertRecipientCheck
{
    public function __construct(private readonly DeviceAuthorization $authorization) {}

    public function forEmail(AlertDelivery $delivery): AlertRecipientVerdict
    {
        return $this->check($delivery, 'email', fn (User $user, Organization $org, string $level): ?string => Preferences::allows($user, 'workflow', $level)
            ? null : 'Recipient email preferences are disabled.');
    }

    public function forPush(AlertDelivery $delivery): AlertRecipientVerdict
    {
        return $this->check($delivery, 'push', function (User $user, Organization $org, string $level): ?string {
            if (! Preferences::pushAllows($user, $org->id, $level)) {
                return 'Recipient push preferences are off for this level or organization.';
            }

            // Devices at another account's address do not count: this alert cannot open there (spec 036).
            return PushDevice::query()->where('user_id', $user->id)->reaching($org)->exists() ? null : 'Recipient has no push devices.';
        });
    }

    /** @param  callable(User, Organization, string): ?string  $preferences */
    private function check(AlertDelivery $delivery, string $channel, callable $preferences): AlertRecipientVerdict
    {
        $alert = Alert::with(['workflow', 'deployment'])->findOrFail($delivery->automation_alert_id);
        if (! $alert->isWorkflow()) {
            return AlertRecipientVerdict::cancel($channel === 'email'
                ? 'Automation alert emails are sent for automation alerts only.'
                : 'Automation alert pushes are sent for automation alerts only.');
        }
        $workflow = $alert->workflow;
        $settings = $workflow->notification_settings ?? [];
        $user = User::find($delivery->recipient_id);
        $org = Organization::find($alert->organization_id);
        $allowed = $user && $org && $user->email_verified_at && $user->organizations()->whereKey($org->id)->exists() && $this->authorization->capabilities($user, $org)['view'];
        // Workflow alerts carry no severity of their own until spec 011; every activation is `warning`.
        $level = $delivery->type === 'cleared' ? 'recovery' : 'warning';
        $reason = match (true) {
            ! $allowed => 'Recipient access is no longer valid.',
            ($preference = $preferences($user, $org, $level)) !== null => $preference,
            ! ($settings['enabled'] ?? false) || ! in_array($delivery->recipient_id, $settings['recipient_ids'] ?? [], true) || ($delivery->type === 'cleared' && ! ($settings['notify_on_clear'] ?? false)) => 'Notification subscription was removed or disabled.',
            $alert->deployment->stopped_reason || $alert->deployment->status === 'failed' || $workflow->desired_deployment_uuid === null => 'Workflow execution has stopped or disable was requested.',
            $delivery->type === 'activated' && $alert->cleared_at !== null => 'Condition cleared before activation '.$channel.' was sent.',
            default => null,
        };
        if ($reason !== null) {
            return AlertRecipientVerdict::cancel($reason);
        }
        if ($alert->deployment->status === 'pending') {
            return AlertRecipientVerdict::release();
        }
        if ($workflow->applied_deployment_uuid !== $alert->deployment->uuid) {
            return AlertRecipientVerdict::cancel('Workflow execution was replaced.');
        }

        return AlertRecipientVerdict::send($alert, $user, $org);
    }
}
