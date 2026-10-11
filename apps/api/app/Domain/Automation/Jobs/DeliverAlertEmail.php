<?php

declare(strict_types=1);

namespace App\Domain\Automation\Jobs;

use App\Domain\Automation\Mail\AlertEmail;
use App\Domain\Automation\Models\Alert;
use App\Domain\Automation\Models\AlertDelivery;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Notifications\Services\Preferences;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Throwable;

final class DeliverAlertEmail implements ShouldQueue
{
    use Queueable;

    public int $tries = 0;

    public int $timeout = 30;

    public int $generation = 0;

    public function __construct(public readonly string $deliveryUuid, int $generation = 0)
    {
        $this->generation = $generation;
    }

    public function retryUntil(): \DateTimeInterface
    {
        return now()->addDay();
    }

    public function backoff(): array
    {
        return [10, 30, 120, 600];
    }

    public function handle(DeviceAuthorization $authorization): void
    {
        $retry = DB::transaction(function () use ($authorization): bool {
            $delivery = AlertDelivery::where('uuid', $this->deliveryUuid)->lockForUpdate()->first();
            if (! $delivery || (int) $delivery->retry_generation !== $this->generation || in_array($delivery->status, ['sent', 'cancelled', 'failed'], true)) {
                return false;
            }
            $alert = Alert::with(['workflow', 'deployment'])->findOrFail($delivery->automation_alert_id);
            $workflow = $alert->workflow;
            $settings = $workflow->notification_settings ?? [];
            $user = User::find($delivery->recipient_id);
            $org = Organization::find($alert->organization_id);
            $allowed = $user && $org && $user->email_verified_at && $user->organizations()->whereKey($org->id)->exists() && $authorization->capabilities($user, $org)['view'];
            $reason = null;
            if (! $allowed) {
                $reason = 'Recipient access is no longer valid.';
            } elseif (! Preferences::allows($user, 'workflow', $delivery->type === 'cleared' ? 'recovery' : 'warning')) {
                $reason = 'Recipient email preferences are disabled.';
            } elseif (! ($settings['enabled'] ?? false) || ! in_array($delivery->recipient_id, $settings['recipient_ids'] ?? [], true) || ($delivery->type === 'cleared' && ! ($settings['notify_on_clear'] ?? false))) {
                $reason = 'Notification subscription was removed or disabled.';
            } elseif ($alert->deployment->stopped_reason || $alert->deployment->status === 'failed' || $workflow->desired_deployment_uuid === null) {
                $reason = 'Workflow execution has stopped or disable was requested.';
            } elseif ($delivery->type === 'activated' && $alert->cleared_at) {
                $reason = 'Condition cleared before activation email was sent.';
            }
            if ($reason) {
                $delivery->update(['status' => 'cancelled', 'diagnostic' => $reason]);

                return false;
            }
            if ($alert->deployment->status === 'pending') {
                $this->release(30);

                return false;
            }
            if ($workflow->applied_deployment_uuid !== $alert->deployment->uuid) {
                $delivery->update(['status' => 'cancelled', 'diagnostic' => 'Workflow execution was replaced.']);

                return false;
            }
            $delivery->attempts++;
            $delivery->cycle_attempts++;
            $failed = false;
            try {
                Mail::to($user->email)->send(new AlertEmail($delivery->uuid, $workflow->name, $alert->uuid, $alert->episode, $delivery->type, ($delivery->type === 'activated' ? $alert->activated_at : $alert->cleared_at)->toIso8601String()));
            } catch (Throwable) {
                $failed = true;
            }
            $delivery->status = $failed ? ($delivery->cycle_attempts >= 5 ? 'failed' : 'pending') : 'sent';
            $delivery->diagnostic = $failed ? 'Email transport failed; delivery may be uncertain.' : null;
            if (! $failed) {
                $delivery->sent_at = now();
            }
            $delivery->save();
            DB::table('automation_alert_delivery_attempts')->insert(['automation_alert_delivery_id' => $delivery->id, 'attempt' => $delivery->attempts, 'status' => $failed ? 'transport_failed' : 'accepted', 'created_at' => now()]);

            return $failed && $delivery->status !== 'failed';
        });
        if ($retry) {
            throw new \RuntimeException('Alert email transport failed; retry scheduled.');
        }
    }

    public function failed(?Throwable $exception): void
    {
        AlertDelivery::where('uuid', $this->deliveryUuid)->where('retry_generation', $this->generation)->where('status', 'pending')->update(['status' => 'failed', 'diagnostic' => 'Delivery retry deadline expired or worker failed.']);
    }
}
