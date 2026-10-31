<?php

declare(strict_types=1);

namespace App\Domain\Audit\Services;

use Illuminate\Support\Str;

/**
 * Words for action codes (spec 024): a sentence that reads after the actor's name and
 * before the subject's ("Ana Silva · updated device · Pump 3"), and the subject's kind.
 * Codes without an entry fall back to their prefix's kind and a readable form of the
 * code, so a new action shows up before it has words of its own.
 */
final class ActivityCatalogue
{
    /** @var array<string, array{0: string, 1: string|null}> */
    private const ACTIONS = [
        // Organizations and access
        'organization.created' => ['created organization', 'organization'],
        'organization.updated' => ['updated organization', 'organization'],
        'organization.deleted' => ['deleted organization', 'organization'],
        'organization.timezone.updated' => ['changed the time zone of', 'organization'],
        'organization.permissions_updated' => ['changed the permission ceiling of', 'organization'],
        'organization.billing_account_changed' => ['changed the billing account of', 'organization'],
        'organization.member.roles_changed' => ['changed the roles of', 'user'],
        'organization.member.removed' => ['removed member', 'user'],
        'organization.role.created' => ['created role', 'role'],
        'organization.role.updated' => ['updated role', 'role'],
        'organization.role.deleted' => ['deleted role', 'role'],
        'organization.invitation.sent' => ['invited', 'invitation'],
        'organization.invitation.resent' => ['resent the invitation to', 'invitation'],
        'organization.invitation.revoked' => ['revoked the invitation to', 'invitation'],
        'organization.invitation.accepted' => ['accepted the invitation for', 'invitation'],
        'super_administrator.invited' => ['invited as super administrator', 'invitation'],
        'user.super_admin_granted' => ['made super administrator', 'user'],
        'user.super_admin_revoked' => ['removed super administrator access from', 'user'],
        'user.platform_administrator_granted' => ['made platform administrator', 'user'],
        'user.platform_administrator_revoked' => ['removed platform administrator access from', 'user'],
        'agents.access_enabled' => ['turned on AI agent access for', 'organization'],
        'agents.access_disabled' => ['turned off AI agent access for', 'organization'],
        'agents.connection_revoked' => ['disconnected an AI agent', null],
        // Billing
        'billing_account.created' => ['created billing account', 'billing_account'],
        'billing_account.updated' => ['updated billing account', 'billing_account'],
        'billing_account.deleted' => ['deleted billing account', 'billing_account'],
        'billing_account.owner_added' => ['added an owner to billing account', 'billing_account'],
        'billing_account.owner_removed' => ['removed an owner from billing account', 'billing_account'],
        // Devices and sites
        'device.registered' => ['registered device', 'device'],
        'device.updated' => ['updated device', 'device'],
        'device.archived' => ['archived device', 'device'],
        'device.configuration.saved' => ['saved the configuration of device', 'device'],
        'device.activation.requested' => ['activated device', 'device'],
        'device.rollback.requested' => ['rolled back device', 'device'],
        'device.deactivation.requested' => ['deactivated device', 'device'],
        'device.onboarding.started' => ['started onboarding device', 'device'],
        'device.onboarding.provisioned' => ['provisioned device', 'device'],
        'device.connection-kit.downloaded' => ['downloaded the connection kit for device', 'device'],
        'command.prepared' => ['prepared a command', 'command'],
        'command.confirmed' => ['sent a command', 'command'],
        'command.cancelled' => ['cancelled a command', 'command'],
        'site.created' => ['created site', 'site'],
        'site.updated' => ['updated site', 'site'],
        'site.deleted' => ['deleted site', 'site'],
        'location_binding.saved' => ['changed how a device is located', null],
        'geofence.saved_and_activated' => ['saved geofence', 'geofence'],
        'connection.provisioned' => ['provisioned a broker connection', null],
        'gateway.registered' => ['registered a gateway', null],
        'gateway.provisioned' => ['provisioned a gateway', null],
        'telemetry.retention.updated' => ['changed telemetry retention', 'organization'],
        'telemetry.capture.started' => ['started a telemetry capture', null],
        'telemetry.capture.diagnosed' => ['diagnosed a telemetry capture', null],
        // Device profiles
        'device_profile.created' => ['created device profile', 'device_profile'],
        'device_profile.updated' => ['updated device profile', 'device_profile'],
        'device_profile.draft_changed' => ['changed the draft of device profile', 'device_profile'],
        'device_profile.published' => ['published device profile', 'device_profile'],
        'device_profile.deleted' => ['deleted device profile', 'device_profile'],
        // Adapters
        'device.adapter.draft.saved' => ['saved adapter', 'device_adapter'],
        'device.adapter.deploy.requested' => ['deployed adapter', 'device_adapter'],
        'device.adapter.deleted' => ['deleted adapter', 'device_adapter'],
        'device.adapter.credential.downloaded' => ['downloaded a credential of adapter', 'device_adapter'],
        'device.adapter.credential.revoked' => ['revoked a credential of adapter', 'device_adapter'],
        'device.adapter.webhook_secret.created' => ['created a webhook secret for adapter', 'device_adapter'],
        'device.adapter.webhook_secret.rotated' => ['rotated the webhook secret of adapter', 'device_adapter'],
        'device.adapter.webhook_secret.revoked' => ['revoked a webhook secret of adapter', 'device_adapter'],
        'device.adapter.cursor.reset' => ['reset the polling cursor of adapter', 'device_adapter'],
        'device.adapter.polling.resumed' => ['resumed polling for adapter', 'device_adapter'],
        // Dashboards
        'dashboard.created' => ['created dashboard', 'dashboard'],
        'dashboard.updated' => ['updated dashboard', 'dashboard'],
        'dashboard.duplicated' => ['duplicated a dashboard as', 'dashboard'],
        'dashboard.restored' => ['restored an earlier version of dashboard', 'dashboard'],
        'dashboard.access_changed' => ['changed who can open dashboard', 'dashboard'],
        'dashboard.deleted' => ['deleted dashboard', 'dashboard'],
        // Automation and alerts
        'workflow.draft_saved' => ['saved automation', 'workflow'],
        'workflow.deployment_requested' => ['deployed automation', 'workflow'],
        'workflow.notifications_updated' => ['changed the notifications of automation', 'workflow'],
        'automation.settings_changed' => ['changed automation settings', null],
        'automation.command_requested' => ['requested an automation command', 'command'],
        'automation.command_reconciled' => ['reconciled an automation command', 'command'],
        'alert.acknowledged' => ['acknowledged an alert', 'alert'],
        'alert.assigned' => ['assigned an alert', 'alert'],
        'alert.commented' => ['commented on an alert', 'alert'],
        'alert.delivery_retried' => ['retried an alert notification', 'alert'],
        // Integrations, support, assistant
        'application.created' => ['created application', 'application'],
        'application.grants_updated' => ['changed the access of application', 'application'],
        'application.token_rotated' => ['rotated the token of application', 'application'],
        'application.revoked' => ['revoked application', 'application'],
        'webhook.configured' => ['configured a webhook', null],
        'webhook.disabled' => ['disabled a webhook', null],
        'webhook.delivery_retried' => ['retried a webhook delivery', null],
        'support.ticket_deleted' => ['deleted a support ticket', null],
        'assistant.settings.updated' => ['changed the AI assistant settings', null],
        'assistant.provider_key.removed' => ['removed an AI provider key', null],
    ];

    /** Kinds by code prefix, longest first, for codes without an entry. */
    private const PREFIXES = [
        'device.adapter.' => 'device_adapter',
        'device_profile.' => 'device_profile',
        'billing_account.' => 'billing_account',
        'organization.' => 'organization',
        'telemetry.capture.' => null,
        'dashboard.' => 'dashboard',
        'workflow.' => 'workflow',
        'command.' => 'command',
        'device.' => 'device',
        'alert.' => 'alert',
        'site.' => 'site',
    ];

    /** What a device profile draft change did, by `change`. */
    private const DRAFT_CHANGES = [
        'parameter.created' => 'added parameter',
        'parameter.updated' => 'edited parameter',
        'parameter.deleted' => 'removed parameter',
        'parameters.reordered' => 'reordered the parameters',
        'parameter_group.created' => 'added group',
        'parameter_group.updated' => 'edited group',
        'parameter_group.deleted' => 'removed group',
        'parameter_groups.reordered' => 'reordered the groups',
        'calculation.created' => 'added a calculation for',
        'calculation.saved' => 'edited the calculation of',
        'calculation.deleted' => 'removed the calculation of',
        'alarm_template.created' => 'added alarm',
        'alarm_template.updated' => 'edited alarm',
        'alarm_template.deleted' => 'removed alarm',
        'transport_binding.created' => 'added binding',
        'transport_binding.mapping_saved' => 'mapped parameters of binding',
        'transport_binding.deleted' => 'removed binding',
    ];

    /**
     * @param  array<string, mixed>  $details
     */
    public static function summary(string $action, array $details = []): string
    {
        if ($action === 'device_profile.draft_changed' && isset(self::DRAFT_CHANGES[$details['change'] ?? ''])) {
            $item = is_string($details['item'] ?? null) ? ' “'.$details['item'].'”' : '';

            return self::DRAFT_CHANGES[$details['change']].$item.' in device profile';
        }

        if (isset(self::ACTIONS[$action])) {
            return self::ACTIONS[$action][0];
        }

        // device.adapter.cursor.reset → "device adapter cursor reset"
        return Str::of($action)->replace(['.', '_', '-'], ' ')->squish()->lower()->toString();
    }

    public static function kind(string $action): ?string
    {
        if (array_key_exists($action, self::ACTIONS)) {
            return self::ACTIONS[$action][1];
        }

        foreach (self::PREFIXES as $prefix => $kind) {
            if (str_starts_with($action, $prefix)) {
                return $kind;
            }
        }

        return null;
    }
}
