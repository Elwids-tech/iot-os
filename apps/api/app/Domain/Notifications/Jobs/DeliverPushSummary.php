<?php

declare(strict_types=1);

namespace App\Domain\Notifications\Jobs;

use App\Domain\Automation\Models\AlertDelivery;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Notifications\Models\PushDevice;
use App\Domain\Notifications\Models\PushSummary;
use App\Domain\Notifications\Services\AlertPushPayload;
use App\Domain\Notifications\Services\Preferences;
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
 * Sends one burst's summary when its window ends (spec 033, FR-024): "{count} more
 * alerts" for one organization, opening its active, unacknowledged alerts. It rechecks
 * the person as each delivery does, and counts only the deliveries linked to it.
 */
final class DeliverPushSummary implements ShouldQueue
{
    use Queueable;

    public int $tries = 0;

    /**
     * Up to ten devices at PushSender's 8 seconds each, and still under the alerts
     * queue's `retry_after` (120), so a slow push service never cuts a send short.
     */
    public int $timeout = 100;

    public function __construct(public readonly string $summaryUuid) {}

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
        $retry = DB::transaction(function () use ($authorization, $sender): bool {
            $summary = PushSummary::query()->where('uuid', $this->summaryUuid)->lockForUpdate()->first();
            if (! $summary || $summary->status !== 'pending') {
                return false;
            }
            if ($summary->window_ends_at->isFuture()) {
                $this->release(max(1, (int) ceil(now()->diffInSeconds($summary->window_ends_at))));

                return false;
            }
            $user = User::find($summary->user_id);
            $org = Organization::find($summary->organization_id);
            $linked = AlertDelivery::query()->where('push_summary_id', $summary->id);
            $count = (clone $linked)->count();
            $active = (clone $linked)->whereHas('alert', fn ($alerts) => $alerts->whereNull('cleared_at'))->count();
            $reason = match (true) {
                ! WebPush::enabled() => 'Push is not configured on this deployment.',
                ! $user || ! $org || ! $user->email_verified_at || ! $user->organizations()->whereKey($org->id)->exists() || ! $authorization->capabilities($user, $org)['view'] => 'Recipient access is no longer valid.',
                ! Preferences::pushAllows($user, $org->id, 'warning') => 'Recipient push preferences are off for this level or organization.',
                $count === 0 || $active === 0 => 'Every alert in the summary has cleared.',
                default => null,
            };
            if ($reason !== null) {
                $summary->update(['status' => 'cancelled', 'diagnostic' => $reason, 'alert_count' => $count]);

                return false;
            }

            $payload = AlertPushPayload::summary($org, $count, $summary->window_ends_at);
            // Not the devices at another account's address, where a tap could not open this (spec 036).
            $devices = PushDevice::query()->where('user_id', $user->id)->reaching($org)->orderBy('id')->get();
            $fanOut = PushFanOut::send($sender, $devices, $payload, AlertPushPayload::options($payload));
            $summary->alert_count = $count;
            $summary->attempts++;
            $summary->cycle_attempts++;
            $summary->devices_total = $fanOut->total();
            $summary->devices_reached = $fanOut->reached();
            $summary->diagnostic = $fanOut->diagnostic();
            if ($fanOut->reached() > 0) {
                $summary->status = 'sent';
                $summary->sent_at = now();
            } else {
                $summary->status = $fanOut->retryable() && $summary->cycle_attempts < 5 ? 'pending' : 'failed';
            }
            $summary->save();

            return $summary->status === 'pending';
        });
        if ($retry) {
            throw new \RuntimeException('Push services did not answer for a summary; retry scheduled.');
        }
    }

    public function failed(?Throwable $exception): void
    {
        PushSummary::query()->where('uuid', $this->summaryUuid)->where('status', 'pending')->update(['status' => 'failed', 'diagnostic' => 'Summary retry deadline expired or worker failed.']);
    }
}
