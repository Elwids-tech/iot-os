<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Http;

use App\Domain\Integrations\Services\ApplicationGrants;
use App\Domain\Integrations\Services\SseWriter;
use App\Domain\Integrations\Services\StreamRelay;
use App\Domain\Integrations\Services\StreamSessions;
use App\Domain\Shared\Models\Organization;
use Dedoc\Scramble\Attributes\HeaderParameter;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\PersonalAccessToken;
use Symfony\Component\HttpFoundation\StreamedResponse;

final class TelemetryStreamController
{
    /** The shape of a position this platform issues (spec 030, research R4). */
    public const POSITION = '/^(0|[1-9][0-9]{0,19})$/';

    /** At most this many devices on one stream, as the runtime accepts. */
    public const MAX_DEVICES = 1000;

    /**
     * The live telemetry stream of the application's granted devices as server-sent
     * events (spec 030, US2): `open`, then `reading` frames whose `id` is the position,
     * `reset` when a resumed position is no longer retained, `: keepalive` comments,
     * and `closed` with a reason when the platform ends the stream.
     */
    #[HeaderParameter('Last-Event-ID', description: 'The position of the last `reading` received; the stream resumes after it. Also accepted as `after`.', required: false, type: 'string')]
    public function stream(Request $request, Organization $organization): StreamedResponse
    {
        // `devices=a,b` is accepted beside `devices[]`: one query variable however many devices.
        if (is_string($request->query('devices'))) {
            $request->merge(['devices' => array_values(array_filter(array_map('trim', explode(',', $request->query('devices'))), 'strlen'))]);
        }
        $values = $request->validate([
            'devices' => ['sometimes', 'array', 'max:'.self::MAX_DEVICES],
            'devices.*' => ['uuid', 'distinct'],
            'after' => ['sometimes', 'string', 'regex:'.self::POSITION],
        ]);
        $after = $request->header('Last-Event-ID') ?? $values['after'] ?? null;
        if ($after !== null && ! preg_match(self::POSITION, $after)) {
            throw ValidationException::withMessages(['after' => 'The position is not one this platform issued.']);
        }
        abort_unless($request->accepts('text/event-stream'), 406, 'Accept text/event-stream to open the stream.');

        $application = $request->attributes->get('integration_application');
        $grant = ApplicationGrants::for($application);
        $subset = isset($values['devices']) ? array_values($values['devices']) : null;
        if ($subset !== null) {
            // Any named device outside the resolved grant refuses the whole request and reveals nothing.
            abort_if($grant->deviceQuery()->whereIn('uuid', $subset)->count() !== count($subset), 404);
        }
        $devices = $subset ?? $grant->resolveUuids();
        abort_if($devices === [], 404, 'No granted device to stream.');
        if (count($devices) > self::MAX_DEVICES) {
            throw ValidationException::withMessages(['devices' => sprintf('The grant covers %d devices; name at most %d with devices[].', count($devices), self::MAX_DEVICES)]);
        }
        $token = PersonalAccessToken::findToken((string) $request->bearerToken());
        abort_if($token === null, 401);

        $relay = app(StreamRelay::class)->for($application, $token, $grant, $subset, $after, $devices);
        $sessions = app(StreamSessions::class);
        $session = $sessions->open($application, count($devices));
        try {
            $body = $relay->open($organization);
        } catch (\Throwable $exception) {
            $sessions->close($session, StreamRelay::RUNTIME_UNAVAILABLE, $after);
            throw $exception;
        }

        return response()->stream(static function () use ($relay, $body, $session): void {
            $relay->run($body, $session, new SseWriter);
        }, 200, [
            'Content-Type' => 'text/event-stream; charset=utf-8',
            'Cache-Control' => 'no-store',
            'X-Accel-Buffering' => 'no',
            'Connection' => 'keep-alive',
        ]);
    }
}
