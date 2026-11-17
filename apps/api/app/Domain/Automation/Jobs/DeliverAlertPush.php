<?php

declare(strict_types=1);

namespace App\Domain\Automation\Jobs;

use App\Domain\Automation\Models\Alert;
use App\Domain\Automation\Models\AlertDelivery;
use App\Domain\Automation\Services\AlertRecipientCheck;
use App\Domain\Automation\Services\AlertRecipientVerdict;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Notifications\Jobs\DeliverPushSummary;
use App\Domain\Notifications\Models\PushDevice;
use App\Domain\Notifications\Models\PushSummary;
use App\Domain\Notifications\Services\AlertPushPayload;
use App\Domain\Notifications\Services\PushFanOut;
use App\Domain\Notifications\Services\PushSender;
use App\Domain\Notifications\Services\WebPush;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Pushes one alert transition to one person's devices (spec 033, FR-018 to FR-026),
 * after the checks email makes. From the fourth activation in a minute from one
 * organization, it joins a summary instead (FR-024).
 */
final class DeliverAlertPush implements ShouldQueue
{
    use Queueable;

    public int $tries = 0;

    /**
     * Up to ten devices at PushSender's 8 seconds each, and still under the alerts
     * queue's `retry_after` (120), so a slow push service never cuts a send short.
     */
    public int $timeout = 100;

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

    public function handle(DeviceAuthorization $authorization, PushSender $sender): void
    {
        $check = new AlertRecipientCheck($authorization);
        $retry = DB::transaction(function () use ($check, $sender): bool {
            $delivery = AlertDelivery::where('uuid', $this->deliveryUuid)->lockForUpdate()->first();
            if (! $delivery || (int) $delivery->retry_generation !== $this->generation || in_array($delivery->status, ['sent', 'cancelled', 'failed', AlertDelivery::SUMMARISED], true)) {
                return false;
            }
            if (! WebPush::enabled()) {
                $delivery->update(['status' => 'cancelled', 'diagnostic' => 'Push is not configured on this deployment.']);

                return false;
            }
            $verdict = $check->forPush($delivery);
            if ($verdict->action === AlertRecipientVerdict::CANCEL) {
                $delivery->update(['status' => 'cancelled', 'diagnostic' => $verdict->reason]);

                return false;
            }
            if ($verdict->action === AlertRecipientVerdict::RELEASE) {
                $this->release(30);

                return false;
            }
            [$alert, $user, $org] = [$verdict->alert, $verdict->user, $verdict->organization];
            if ($delivery->type === 'activated' && $this->summarise($delivery, $user, $org)) {
                return false;
            }

            $payload = AlertPushPayload::transition($alert, $org, $delivery->type, $this->deviceName($alert));
            $devices = PushDevice::query()->where('user_id', $user->id)->orderBy('id')->get();
            $delivery->attempts++;
            $delivery->cycle_attempts++;
            $fanOut = PushFanOut::send($sender, $devices, $payload, AlertPushPayload::options($payload));
            foreach ($fanOut->results as $row) {
                DB::table('automation_alert_delivery_attempts')->insert([
                    'automation_alert_delivery_id' => $delivery->id,
                    'attempt' => $delivery->attempts,
                    'status' => $row['result']->outcome,
                    'device_label' => $row['label'],
                    'response_status' => $row['result']->status,
                    'created_at' => now(),
                ]);
            }
            $delivery->devices_total = $fanOut->total();
            $delivery->devices_reached = $fanOut->reached();
            $delivery->diagnostic = $fanOut->diagnostic();
            if ($fanOut->reached() > 0) {
                $delivery->status = 'sent';
                $delivery->sent_at = now();
            } else {
                $delivery->status = $fanOut->retryable() && $delivery->cycle_attempts < 5 ? 'pending' : 'failed';
            }
            $delivery->save();

            return $delivery->status === 'pending';
        });
        if ($retry) {
            throw new \RuntimeException('Push services did not answer; retry scheduled.');
        }
    }

    public function failed(?Throwable $exception): void
    {
        AlertDelivery::where('uuid', $this->deliveryUuid)->where('retry_generation', $this->generation)->where('status', 'pending')->update(['status' => 'failed', 'diagnostic' => 'Delivery retry deadline expired or worker failed.']);
    }

    /**
     * FR-024, decided one person at a time under a lock on their preferences row: join
     * the open summary for this organization, or open one once three pushes went out in
     * the last minute. Deliveries link to the summary, so windows never overlap and an
     * alert is counted once.
     */
    private function summarise(AlertDelivery $delivery, User $user, Organization $org): bool
    {
        DB::table('notification_preferences')->where('user_id', $user->id)->lockForUpdate()->first();
        $summary = PushSummary::query()->where('user_id', $user->id)->where('organization_id', $org->id)
            ->where('status', 'pending')->where('window_ends_at', '>', now())->first();
        if (! $summary) {
            $recent = AlertDelivery::query()
                ->join('automation_alerts', 'automation_alerts.id', '=', 'automation_alert_deliveries.automation_alert_id')
                ->where('automation_alerts.organization_id', $org->id)
                ->where('automation_alert_deliveries.recipient_id', $user->id)
                ->where('automation_alert_deliveries.channel', AlertDelivery::PUSH)
                // Only activations count toward the three (FR-024); clears never open a summary.
                ->where('automation_alert_deliveries.type', 'activated')
                ->where('automation_alert_deliveries.status', 'sent')
                ->where('automation_alert_deliveries.sent_at', '>=', now()->subSeconds(PushSummary::WINDOW_SECONDS))
                ->count();
            if ($recent < PushSummary::BURST) {
                return false;
            }
            $start = now();
            $summary = PushSummary::query()->create([
                'user_id' => $user->id,
                'organization_id' => $org->id,
                'window_started_at' => $start,
                'window_ends_at' => $start->copy()->addSeconds(PushSummary::WINDOW_SECONDS),
                'status' => 'pending',
            ]);
            DeliverPushSummary::dispatch($summary->uuid)->onConnection('alerts')->onQueue('alerts')->delay($summary->window_ends_at);
        }
        $delivery->update(['status' => AlertDelivery::SUMMARISED, 'push_summary_id' => $summary->id, 'diagnostic' => null]);

        return true;
    }

    private function deviceName(Alert $alert): ?string
    {
        return $alert->devices()->orderBy('devices.name')->value('devices.name');
    }
}
