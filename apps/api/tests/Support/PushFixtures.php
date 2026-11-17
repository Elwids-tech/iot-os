<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Domain\Notifications\Models\PushDevice;
use App\Domain\Shared\Models\User;
use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Minishlink\WebPush\VAPID;

/**
 * Push alert test helpers (spec 033): a deployment key pair, browsers with real P-256
 * keys (the sender encrypts to them), and a faked push service.
 */
trait PushFixtures
{
    protected function enablePush(): void
    {
        $keys = VAPID::createVapidKeys();
        config([
            'webpush.vapid.public_key' => $keys['publicKey'],
            'webpush.vapid.private_key' => $keys['privateKey'],
            'webpush.vapid.subject' => 'mailto:ops@example.test',
        ]);
    }

    /** @return array{endpoint: string, keys: array{p256dh: string, auth: string}, content_encoding: string, label: string} */
    protected function browserSubscription(string $label = 'Chrome on Android'): array
    {
        $key = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
        $ec = openssl_pkey_get_details($key)['ec'];
        $point = "\x04".str_pad($ec['x'], 32, "\0", STR_PAD_LEFT).str_pad($ec['y'], 32, "\0", STR_PAD_LEFT);

        return [
            'endpoint' => 'https://push.example.test/send/'.Str::random(24),
            'keys' => ['p256dh' => self::base64Url($point), 'auth' => self::base64Url(random_bytes(16))],
            'content_encoding' => 'aes128gcm',
            'label' => $label,
        ];
    }

    protected function pushDevice(User $user, string $label = 'Chrome on Android'): PushDevice
    {
        $subscription = $this->browserSubscription($label);

        return PushDevice::query()->create([
            'user_id' => $user->id,
            'endpoint' => $subscription['endpoint'],
            'endpoint_hash' => PushDevice::hash($subscription['endpoint']),
            'public_key' => $subscription['keys']['p256dh'],
            'auth_token' => $subscription['keys']['auth'],
            'content_encoding' => 'aes128gcm',
            'label' => $label,
            'created_at' => now(),
            'last_synced_at' => now(),
        ]);
    }

    /** @var int|\Closure(ClientRequest): int */
    private int|\Closure $pushStatus = 201;

    private bool $pushFaked = false;

    private string $pushBody = '';

    /**
     * Every push service answers with this status (201 accepted), or with what the
     * closure returns for each request. Calling it again changes the answer: Http::fake
     * keeps its first stub, so one stub reads this setting.
     *
     * @param  int|\Closure(ClientRequest): int  $status
     * @param  string  $body  what the push service says, such as a 403's reason
     */
    protected function fakePushService(int|\Closure $status = 201, string $body = ''): void
    {
        $this->pushStatus = $status;
        $this->pushBody = $body;
        if (! $this->pushFaked) {
            $this->pushFaked = true;
            Http::fake(['push.example.test/*' => fn (ClientRequest $request) => Http::response($this->pushBody, is_int($this->pushStatus) ? $this->pushStatus : ($this->pushStatus)($request))]);
        }
    }

    /** @return list<array{url: string, headers: array<string, list<string>>}> */
    protected function pushesSent(): array
    {
        return Http::recorded()
            ->filter(fn (array $pair): bool => str_contains($pair[0]->url(), 'push.example.test'))
            ->map(fn (array $pair): array => ['url' => $pair[0]->url(), 'headers' => $pair[0]->headers()])
            ->values()->all();
    }

    private static function base64Url(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }
}
