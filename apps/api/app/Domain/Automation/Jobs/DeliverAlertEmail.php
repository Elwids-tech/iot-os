<?php

declare(strict_types=1);

namespace App\Domain\Automation\Jobs;

use App\Domain\Automation\Mail\AlertEmail;
use App\Domain\Automation\Models\AlertDelivery;
use App\Domain\Automation\Services\AlertRecipientCheck;
use App\Domain\Automation\Services\AlertRecipientVerdict;
use App\Domain\Devices\Services\DeviceAuthorization;
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
        $check = new AlertRecipientCheck($authorization);
        $retry = DB::transaction(function () use ($check): bool {
            $delivery = AlertDelivery::where('uuid', $this->deliveryUuid)->lockForUpdate()->first();
            if (! $delivery || (int) $delivery->retry_generation !== $this->generation || in_array($delivery->status, ['sent', 'cancelled', 'failed'], true)) {
                return false;
            }
            $verdict = $check->forEmail($delivery);
            if ($verdict->action === AlertRecipientVerdict::CANCEL) {
                $delivery->update(['status' => 'cancelled', 'diagnostic' => $verdict->reason]);

                return false;
            }
            if ($verdict->action === AlertRecipientVerdict::RELEASE) {
                $this->release(30);

                return false;
            }
            [$alert, $user, $org] = [$verdict->alert, $verdict->user, $verdict->organization];
            $delivery->attempts++;
            $delivery->cycle_attempts++;
            $failed = false;
            try {
                Mail::to($user->email)->send(new AlertEmail($delivery->uuid, $alert, $org, $delivery->type));
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
