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
        try {
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
        } catch (\ErrorException|\RuntimeException|\ValueError $error) {
            // The package encrypts before sending, and throws for keys it can't use. Only
            // this device fails; the person's other devices still get the push (FR-026).
            $result = new PushResult(PushResult::REJECTED, null, 'Could not encrypt for this browser: '.$error->getMessage());
            $this->recordFailure($device, $result);

            return $result;
        }
        $status = $report->getResponse()?->getStatusCode();
        $result = match (true) {
            $report->isSuccess() => new PushResult(PushResult::ACCEPTED, $status),
            in_array($status, [404, 410], true),
            $status === 403 && self::keyMismatch((string) $report->getResponseContent().' '.$report->getReason()) => new PushResult(PushResult::GONE, $status, $report->getReason()),
            $status !== null && $status >= 400 && $status < 500 && $status !== 429 => new PushResult(PushResult::REJECTED, $status, $report->getReason()),
            default => new PushResult(PushResult::TRANSPORT_FAILED, $status, $report->getReason()),
        };

        if ($result->accepted()) {
            $device->forceFill(['last_reached_at' => now()])->save();
        } elseif ($result->outcome === PushResult::GONE) {
            $device->delete();
        } else {
            $this->recordFailure($device, $result);
        }

        return $result;
    }

    /**
     * A 403 means the subscription is gone only when the push service says it was made
     * with another key (Apple's `VapidPkHashMismatch`, Google's "does not correspond").
     * Any other 403, such as a token the service refused, is this server's problem and
     * must not delete every device (data-model: Push device).
     */
    public static function keyMismatch(string $answer): bool
    {
        return preg_match('/mismatch|(?:does|do)\s?n[o\']t\s+(?:correspond|match)/i', $answer) === 1;
    }

    private function recordFailure(PushDevice $device, PushResult $result): void
    {
        $device->forceFill([
            'last_failed_at' => now(),
            'last_failure' => Str::limit(trim(($result->status ?? 'no response').' '.$result->reason), 255, ''),
        ])->save();
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
            // Push services answer in well under a second; ten slow ones fit the job's 100 s.
            Http::connectTimeout(3)->timeout(8)->buildClient(),
            new HttpFactory,
            new HttpFactory,
        ))->setReuseVAPIDHeaders(true)->setAutomaticPadding(true);
    }
}
