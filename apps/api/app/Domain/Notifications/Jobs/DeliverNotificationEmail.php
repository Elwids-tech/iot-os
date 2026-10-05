<?php

declare(strict_types=1);

namespace App\Domain\Notifications\Jobs;

use App\Domain\Notifications\Models\NotificationEvent;
use App\Domain\Notifications\Services\Preferences;
use App\Domain\Shared\Models\User;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

final class DeliverNotificationEmail implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 30;

    public function __construct(public readonly int $deliveryId) {}

    public function backoff(): array
    {
        return [30, 120, 600];
    }

    public function handle(): void
    {
        DB::transaction(function (): void {
            $delivery = DB::table('notification_email_deliveries')->where('id', $this->deliveryId)->lockForUpdate()->first();
            if (! $delivery || $delivery->status !== 'pending') {
                return;
            }
            $event = NotificationEvent::findOrFail($delivery->notification_event_id);
            $user = User::find($delivery->user_id);
            $level = $event->status === 'resolved' ? 'recovery' : $event->severity;
            if (! $user || ! $user->is_super_admin || ! $user->email_verified_at || ! Preferences::allows($user, $event->source, $level) || ($event->status === 'firing' && ! $event->active)) {
                DB::table('notification_email_deliveries')->where('id', $delivery->id)->update(['status' => 'cancelled', 'updated_at' => now()]);

                return;
            }
            Mail::raw($event->summary."\n\nView events: ".rtrim(config('notifications.portal_url'), '/').'/notifications', function ($message) use ($user, $event): void {
                $message->to($user->email)->subject('['.strtoupper($event->status).'] Elwids: '.$event->title);
            });
            DB::table('notification_email_deliveries')->where('id', $delivery->id)->update(['status' => 'sent', 'sent_at' => now(), 'updated_at' => now()]);
        });
    }

    public function failed(?\Throwable $exception): void
    {
        DB::table('notification_email_deliveries')->where('id', $this->deliveryId)->where('status', 'pending')->update(['status' => 'failed', 'updated_at' => now()]);
    }
}
