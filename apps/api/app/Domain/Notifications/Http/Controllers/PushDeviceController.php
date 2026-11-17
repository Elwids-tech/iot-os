<?php

declare(strict_types=1);

namespace App\Domain\Notifications\Http\Controllers;

use App\Domain\Authentication\Models\KeptSignIn;
use App\Domain\Authentication\Services\KeptSignInCookie;
use App\Domain\Notifications\Models\PushDevice;
use App\Domain\Notifications\Services\AlertPushPayload;
use App\Domain\Notifications\Services\Preferences;
use App\Domain\Notifications\Services\PushResult;
use App\Domain\Notifications\Services\PushSender;
use App\Domain\Notifications\Services\WebPush;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The browsers a person turned push on in (spec 033, FR-017, FR-020, FR-028,
 * contracts/push-api.md). Personal: only the owner sees or changes them, and endpoints
 * and keys never leave the server.
 */
final class PushDeviceController
{
    public function store(Request $request): JsonResponse
    {
        abort_unless(WebPush::enabled(), 409, 'push_unavailable');
        $input = $request->validate([
            'endpoint' => ['required', 'string', 'url:https', 'max:2048'],
            'keys' => ['required', 'array'],
            'keys.p256dh' => ['required', 'string', 'max:255', self::key(65, "\x04")],
            'keys.auth' => ['required', 'string', 'max:255', self::key(16)],
            'content_encoding' => ['nullable', 'in:aes128gcm,aesgcm'],
            'label' => ['nullable', 'string', 'max:60'],
        ]);
        /** @var User $user */
        $user = $request->user();

        [$device, $created, $replaced] = DB::transaction(function () use ($request, $user, $input): array {
            Preferences::row($user);
            $existing = PushDevice::query()->where('endpoint_hash', PushDevice::hash($input['endpoint']))->lockForUpdate()->first();
            if ($existing && $existing->user_id !== $user->id) {
                // Holding the endpoint proves control of the browser; the last person loses it.
                $existing->delete();
                $existing = null;
            }
            $replaced = null;
            if (! $existing && PushDevice::query()->where('user_id', $user->id)->count() >= PushDevice::LIMIT) {
                $oldest = PushDevice::query()->where('user_id', $user->id)
                    ->orderByRaw('coalesce(last_reached_at, created_at) asc')->orderBy('id')->first();
                $replaced = ['label' => $oldest->label];
                $oldest->delete();
            }
            $device = $existing ?? new PushDevice(['user_id' => $user->id, 'created_at' => now()]);
            $device->fill([
                'endpoint' => $input['endpoint'],
                'endpoint_hash' => PushDevice::hash($input['endpoint']),
                'public_key' => $input['keys']['p256dh'],
                'auth_token' => $input['keys']['auth'],
                'content_encoding' => $input['content_encoding'] ?? 'aes128gcm',
                'label' => $input['label'] ?: 'Browser',
                ...$this->links($request),
                'last_synced_at' => now(),
            ])->save();
            Preferences::enablePushDefaults($user);

            return [$device, ! $existing, $replaced];
        });

        return response()->json(['data' => ['uuid' => $device->uuid, 'label' => $device->label, 'replaced' => $replaced]], $created ? 201 : 200);
    }

    public function sync(Request $request): array
    {
        $input = $request->validate(['endpoint' => ['required', 'string', 'max:2048']]);
        $user = $request->user();

        return ['data' => DB::transaction(function () use ($request, $user, $input): array {
            $device = PushDevice::query()->where('endpoint_hash', PushDevice::hash($input['endpoint']))->lockForUpdate()->first();
            if (! $device) {
                return ['status' => 'unknown', 'uuid' => null];
            }
            if ($device->user_id !== $user->id) {
                $device->delete();

                return ['status' => 'released', 'uuid' => null];
            }
            $device->fill([...$this->links($request), 'last_synced_at' => now()])->save();

            return ['status' => 'mine', 'uuid' => $device->uuid];
        })];
    }

    public function destroy(Request $request, string $device): Response
    {
        $model = $this->owned($request, $device);
        DB::transaction(function () use ($model): void {
            // Removing a device signs that browser out too (spec 033 edge case: lost phone).
            if ($model->kept_sign_in_id !== null) {
                KeptSignIn::query()->find($model->kept_sign_in_id)?->end(KeptSignIn::DEVICE_REMOVED);
            }
            if ($model->session_id) {
                app('session')->getHandler()->destroy($model->session_id);
            }
            $model->delete();
        });

        return response()->noContent();
    }

    public function test(Request $request, string $device, PushSender $sender): array
    {
        abort_unless(WebPush::enabled(), 409, 'push_unavailable');
        $model = $this->owned($request, $device);
        $payload = AlertPushPayload::test(now());
        $result = $sender->send($model, $payload, AlertPushPayload::options($payload));

        return ['data' => ['status' => match ($result->outcome) {
            PushResult::ACCEPTED => 'accepted',
            PushResult::GONE => 'gone',
            default => 'failed',
        }]];
    }

    private function owned(Request $request, string $uuid): PushDevice
    {
        abort_unless(Str::isUuid($uuid), 404);

        return PushDevice::query()->where('uuid', $uuid)->where('user_id', $request->user()->id)->firstOrFail();
    }

    /** @return array{session_id: ?string, kept_sign_in_id: ?int} */
    private function links(Request $request): array
    {
        $session = $request->hasSession() ? $request->session() : null;

        return [
            'session_id' => $session?->getId(),
            'kept_sign_in_id' => $session?->get(KeptSignInCookie::SESSION_KEY),
        ];
    }

    /**
     * A browser's key, base64url: the P-256 point (65 bytes, uncompressed) or the 16-byte
     * auth secret. Anything else can't be encrypted to, so it is refused here rather than
     * failing every push later (FR-026).
     */
    private static function key(int $bytes, string $prefix = ''): \Closure
    {
        return function (string $attribute, mixed $value, \Closure $fail) use ($bytes, $prefix): void {
            $raw = is_string($value) ? base64_decode(strtr($value, '-_', '+/'), true) : false;
            if ($raw === false || strlen($raw) !== $bytes || ! str_starts_with($raw, $prefix)) {
                $fail('The :attribute is not a browser push key.');
            }
        };
    }
}
