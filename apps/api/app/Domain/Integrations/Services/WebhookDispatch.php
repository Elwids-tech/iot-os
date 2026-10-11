<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Services;

use App\Domain\Devices\Models\Device;
use App\Domain\Integrations\Models\IntegrationApplication;
use App\Domain\Integrations\Models\Webhook;
use App\Domain\Integrations\Models\WebhookDelivery;
use App\Domain\Shared\Models\Organization;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

final class WebhookDispatch
{
    public function tick(int $id): void
    {
        $reference = Webhook::find($id);
        if (! $reference) {
            return;
        }
        // Persist delivery identity/body BEFORE network I/O so a crash retries
        // the same logical delivery. No work is scheduled in telemetry's path.
        $delivery = DB::transaction(function () use ($reference) {
            $app = IntegrationApplication::whereKey($reference->integration_application_id)->lockForUpdate()->first();
            $hook = Webhook::whereKey($reference->id)->lockForUpdate()->first();
            if (! $app || ! $hook || ! $this->eligible($app, $hook)) {
                return null;
            }
            if ($hook->next_dispatch_at?->isFuture()) {
                return null;
            }
            $pending = WebhookDelivery::where('integration_webhook_id', $hook->id)->where('status', 'pending')->orderBy('id')->first();
            if ($pending) {
                return $pending->uuid;
            }
            $head = (int) DB::table('integration_streams')->where('organization_id', $app->organization_id)->value('sequence');
            $devices = Device::where('organization_id', $app->organization_id)->whereIn('uuid', $app->device_uuids)->pluck('uuid');
            $event = DB::table('integration_events')->where('organization_id', $app->organization_id)->whereIn('device_uuid', $devices)->where('sequence', '>', $hook->cursor)->where('sequence', '<=', $head)->orderBy('sequence')->first();
            $hook->update(['cursor' => $event ? $event->sequence : $head]);
            if (! $event) {
                return null;
            }
            $body = json_encode(['id' => $event->uuid, 'schema_version' => 'integration-event.v1', 'type' => $event->type, 'occurred_at' => Carbon::parse($event->occurred_at)->toIso8601String(), 'recorded_at' => Carbon::parse($event->recorded_at)->toIso8601String(), 'data' => json_decode($event->snapshot, true, 512, JSON_THROW_ON_ERROR)], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);

            return WebhookDelivery::firstOrCreate(['integration_webhook_id' => $hook->id, 'integration_event_id' => $event->id], ['webhook_revision' => $hook->revision, 'body' => $body, 'next_attempt_at' => now(), 'expires_at' => now()->addDay()])->uuid;
        });
        if (! $delivery) {
            return;
        }
        DB::transaction(function () use ($reference, $delivery): void {
            $app = IntegrationApplication::whereKey($reference->integration_application_id)->lockForUpdate()->first();
            $hook = Webhook::whereKey($reference->id)->lockForUpdate()->first();
            $record = WebhookDelivery::where('uuid', $delivery)->lockForUpdate()->first();
            if (! $app || ! $hook || ! $record || $record->status !== 'pending') {
                return;
            }
            if (! $this->eligible($app, $hook)) {
                return;
            }
            $event = DB::table('integration_events')->where('id', $record->integration_event_id)->first();
            if ($record->webhook_revision !== $hook->revision || ! $event || ! in_array($event->device_uuid, $app->device_uuids, true) || ! Device::where('organization_id', $app->organization_id)->where('uuid', $event->device_uuid)->exists()) {
                $record->update(['status' => 'cancelled', 'diagnostic' => 'Endpoint or device grant changed.']);

                return;
            }
            if ($record->expires_at->isPast()) {
                $record->update(['status' => 'failed', 'diagnostic' => 'Retry deadline expired.']);

                return;
            }
            if ($record->next_attempt_at->isFuture() || $hook->next_dispatch_at?->isFuture()) {
                return;
            }
            // Keep the application lock during the bounded send: revocation
            // waits for this admitted request, then prevents every later send.
            try {
                $target = app(WebhookDestination::class)->target($hook->url);
            } catch (\InvalidArgumentException) {
                $record->update(['status' => 'failed', 'diagnostic' => 'Destination is no longer permitted.']);
                $hook->update(['enabled' => false, 'diagnostic' => 'Destination is no longer permitted.']);

                return;
            }
            $status = app(WebhookTransport::class)->send($hook->url, $target, $record->body, $record->uuid, $hook->secret);
            $attempts = $record->attempts + 1;
            $success = $status !== null && $status >= 200 && $status < 300;
            $retryable = $status === null || in_array($status, [408, 425, 429], true) || $status >= 500;
            $nextStatus = $success ? 'delivered' : ($retryable && $attempts < $record->attempt_limit ? 'pending' : 'failed');
            $delay = [10, 30, 120, 600][min($attempts - ($record->attempt_limit - 5) - 1, 3)];
            $record->update(['status' => $nextStatus, 'attempts' => $attempts, 'next_attempt_at' => now()->addSeconds($delay), 'delivered_at' => $success ? now() : null, 'diagnostic' => $success ? null : 'Receiver did not confirm delivery; outcome may be uncertain.']);
            DB::table('integration_webhook_attempts')->insert(['integration_webhook_delivery_id' => $record->id, 'attempt' => $attempts, 'http_status' => $status, 'outcome' => $success ? 'accepted' : 'unconfirmed', 'created_at' => now()]);
            $hook->update(['next_dispatch_at' => now()->addSecond()]);
        });
    }

    private function eligible(IntegrationApplication $app, Webhook $hook): bool
    {
        if (! $hook->enabled) {
            return false;
        }
        if ($app->revoked_at || $app->grant_revision !== $hook->grant_revision || array_diff(['events:read', 'alerts:read'], $app->abilities) || ! Organization::whereKey($app->organization_id)->exists()) {
            self::cancel($app->id, 'Application access changed.');

            return false;
        }

        return true;
    }

    public static function cancel(int $application, string $reason): void
    {
        $ids = Webhook::where('integration_application_id', $application)->pluck('id');
        Webhook::whereIn('id', $ids)->update(['enabled' => false, 'diagnostic' => $reason]);
        WebhookDelivery::whereIn('integration_webhook_id', $ids)->where('status', 'pending')->update(['status' => 'cancelled', 'diagnostic' => $reason]);
    }
}
