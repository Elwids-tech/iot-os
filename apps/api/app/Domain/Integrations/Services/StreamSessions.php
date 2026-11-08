<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Services;

use App\Domain\Integrations\Models\IntegrationApplication;
use App\Domain\Integrations\Models\IntegrationStreamSession;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;

/**
 * Opens, refreshes, closes and prunes telemetry stream sessions, and enforces the
 * open-stream limits (spec 030, research R5): 2 per application, 10 per organization
 * and `IOT_STREAMS_MAX_OPEN` per deployment, counted on open streams inside one
 * transaction with the application row locked.
 */
final class StreamSessions
{
    /** A stream is open while its last touch is within this many seconds. */
    public const OPEN_WINDOW_SECONDS = 90;

    /** What a refused client is told to wait before trying again. */
    public const RETRY_AFTER_SECONDS = 30;

    /** Rows older than this are pruned. */
    public const KEEP_DAYS = 30;

    /**
     * @throws HttpResponseException a 429 with `Retry-After` and a body naming the limit
     */
    public function open(IntegrationApplication $application, int $deviceCount): IntegrationStreamSession
    {
        return DB::transaction(function () use ($application, $deviceCount): IntegrationStreamSession {
            IntegrationApplication::whereKey($application->getKey())->lockForUpdate()->first();
            $open = IntegrationStreamSession::query()->open();
            $limits = [
                [(clone $open)->where('integration_application_id', $application->getKey())->count(), (int) config('integrations.streams_per_application'), 'This application already has %d open telemetry streams; the limit is %d per application.'],
                [(clone $open)->where('organization_id', $application->organization_id)->count(), (int) config('integrations.streams_per_organization'), 'This organization already has %d open telemetry streams; the limit is %d per organization.'],
                [(clone $open)->count(), (int) config('integrations.streams_max_open'), 'The platform already has %d open telemetry streams; the limit is %d.'],
            ];
            foreach ($limits as [$count, $limit, $message]) {
                if ($count >= $limit) {
                    throw new HttpResponseException(response()->json(['message' => sprintf($message, $count, $limit)], 429)
                        ->header('Retry-After', (string) self::RETRY_AFTER_SECONDS));
                }
            }

            return IntegrationStreamSession::create([
                'integration_application_id' => $application->getKey(), 'organization_id' => $application->organization_id,
                'opened_at' => now(), 'last_seen_at' => now(), 'device_count' => $deviceCount,
            ]);
        });
    }

    /** Refreshes the open window and records the last position relayed. */
    public function touch(IntegrationStreamSession $session, ?string $position): void
    {
        $session->forceFill(['last_seen_at' => now()] + ($position === null ? [] : ['last_position' => $position]))->save();
    }

    public function close(IntegrationStreamSession $session, string $reason, ?string $position): void
    {
        $session->forceFill(['closed_at' => now(), 'last_seen_at' => now(), 'close_reason' => $reason] + ($position === null ? [] : ['last_position' => $position]))->save();
    }

    /** Deletes rows opened more than KEEP_DAYS ago; returns how many. */
    public function prune(): int
    {
        return IntegrationStreamSession::where('opened_at', '<', now()->subDays(self::KEEP_DAYS))->delete();
    }
}
