<?php

declare(strict_types=1);

namespace App\Domain\Notifications\Services;

use App\Domain\Notifications\Models\PushDevice;
use GuzzleHttp\Psr7\HttpFactory;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush as PushClient;

/**
 * Sends one encrypted push to one device (spec 033, research R12). The package's
 * notification channel only accepts its own subscription model, so this builds the same
 * client it does: the deployment's VAPID pair, payload padding, and Laravel's HTTP
 * client, so tests use `Http::fake()`.
 */
final class PushSender
{
    private ?PushClient $client = null;

    /**
     * @param  array<string, mixed>  $payload  an alert-push.v1 body
     * @param  array{TTL?: int, urgency?: string, topic?: string}  $options
     */
    public function send(PushDevice $device, array $payload, array $options): PushResult
    {
        $report = $this->client()->sendOneNotification(
            Subscription::create([
                'endpoint' => $device->endpoint,
                'publicKey' => $device->public_key,
                'authToken' => $device->auth_token,
                'contentEncoding' => $device->content_encoding,
            ]),
            json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES),
            $options,
        );
        $status = $report->getResponse()?->getStatusCode();
        $result = match (true) {
            $report->isSuccess() => new PushResult(PushResult::ACCEPTED, $status),
            in_array($status, [403, 404, 410], true) => new PushResult(PushResult::GONE, $status, $report->getReason()),
            $status !== null && $status >= 400 && $status < 500 && $status !== 429 => new PushResult(PushResult::REJECTED, $status, $report->getReason()),
            default => new PushResult(PushResult::TRANSPORT_FAILED, $status, $report->getReason()),
        };

        if ($result->accepted()) {
            $device->forceFill(['last_reached_at' => now()])->save();
        } elseif ($result->outcome === PushResult::GONE) {
            $device->delete();
        } else {
            $device->forceFill([
                'last_failed_at' => now(),
                'last_failure' => Str::limit(trim(($status ?? 'no response').' '.$result->reason), 255, ''),
            ])->save();
        }

        return $result;
    }

    private function client(): PushClient
    {
        return $this->client ??= (new PushClient(
            ['VAPID' => [
                'subject' => config('webpush.vapid.subject') ?: (string) config('app.url'),
                'publicKey' => (string) config('webpush.vapid.public_key'),
                'privateKey' => (string) config('webpush.vapid.private_key'),
            ]],
            [],
            Http::timeout(15)->buildClient(),
            new HttpFactory,
            new HttpFactory,
        ))->setReuseVAPIDHeaders(true)->setAutomaticPadding(true);
    }
}
