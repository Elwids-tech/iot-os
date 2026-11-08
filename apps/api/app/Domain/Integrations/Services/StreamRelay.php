<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Services;

use App\Domain\Devices\Services\RuntimeClient;
use App\Domain\Integrations\Models\IntegrationApplication;
use App\Domain\Integrations\Models\IntegrationStreamSession;
use App\Domain\Shared\Models\Organization;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\PersonalAccessToken;
use Psr\Http\Message\StreamInterface;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Relays one application telemetry stream from the runtime to the client (spec 030,
 * research R2). Frames pass through byte for byte; between them, every
 * `stream_recheck_seconds` the relay re-reads the application's grant revision and
 * revocation, the token's existence and expiry, touches the session row and, for a
 * site scope, re-resolves the device set. A changed set reopens the internal stream
 * from the last relayed position with the new devices and drops that stream's `open`,
 * so the client keeps one stream and one `open` (FR-008). The relay ends with a
 * `closed` event naming its reason, and closes the session with it.
 *
 * One instance serves one request: resolve it from the container per request.
 */
final class StreamRelay
{
    public const LIFETIME = 'lifetime';

    public const GRANT_CHANGED = 'grant_changed';

    public const CREDENTIALS_CHANGED = 'credentials_changed';

    public const RUNTIME_UNAVAILABLE = 'runtime_unavailable';

    public const SHUTDOWN = 'shutdown';

    public const CLIENT = 'client';

    /** The runtime answered `reset`: the client takes a new snapshot; no `closed` follows. */
    public const RESET = 'reset';

    private const PATH = '/internal/telemetry/stream';

    /** Whether the client went away; `connection_aborted()` learns it from a failed write. */
    public Closure $clientGone;

    /** Whether the process was asked to stop. */
    public Closure $terminating;

    private Organization $organization;

    private IntegrationApplication $application;

    private PersonalAccessToken $token;

    private ApplicationGrant $grant;

    /** @var ?list<string> */
    private ?array $subset = null;

    /** @var list<string> the device set the current internal stream was opened with */
    private array $devices = [];

    private ?string $position = null;

    private ?string $openPosition = null;

    private bool $openRelayed = false;

    private bool $dropNextOpen = false;

    private bool $resetRelayed = false;

    private bool $reopen = false;

    private ?string $reason = null;

    private string $buffer = '';

    private CarbonImmutable $deadline;

    private CarbonImmutable $nextCheck;

    private CarbonImmutable $lastWrite;

    private SseWriter $writer;

    public function __construct(private readonly RuntimeClient $runtime, private readonly StreamSessions $sessions)
    {
        $this->clientGone = static fn (): bool => connection_aborted() === 1;
        $this->terminating = self::terminationWatcher();
    }

    /**
     * @param  ?list<string>  $subset  the devices the client named, or null for the whole grant
     * @param  list<string>  $devices  the resolved device set the stream opens with
     */
    public function for(IntegrationApplication $application, PersonalAccessToken $token, ApplicationGrant $grant, ?array $subset, ?string $after, array $devices): self
    {
        $this->application = $application;
        $this->token = $token;
        $this->grant = $grant;
        $this->subset = $subset;
        $this->devices = self::sorted($devices);
        $this->position = $after;

        return $this;
    }

    /**
     * Opens the first internal stream; a refusal (503, 422) surfaces here, before the
     * client has received a byte.
     */
    public function open(Organization $organization): StreamInterface
    {
        $this->organization = $organization;

        return $this->runtime->openStream(self::PATH, $this->query());
    }

    /** Runs inside the streamed response: relays until a reason ends the stream. */
    public function run(StreamInterface $body, IntegrationStreamSession $session, SseWriter $writer): void
    {
        set_time_limit(0);
        ignore_user_abort(true);
        $this->writer = $writer;
        $now = CarbonImmutable::now();
        $this->deadline = $now->addSeconds((int) config('integrations.stream_lifetime_seconds'));
        $this->nextCheck = $now->addSeconds((int) config('integrations.stream_recheck_seconds'));
        $this->lastWrite = $now;

        while ($this->reason === null) {
            $this->buffer = '';
            $this->runtime->readStream($body, $this->onChunk(...), fn (): bool => $this->shouldStop($session));
            if ($this->reason !== null) {
                break;
            }
            if ($this->resetRelayed) {
                $this->reason = self::RESET;
                break;
            }
            if ($this->reopen) {
                // The device set changed: continue from the last relayed position with the
                // new set, and drop that stream's `open` so the client sees one.
                $this->reopen = false;
                try {
                    $body = $this->runtime->openStream(self::PATH, $this->query());
                    $this->dropNextOpen = true;
                } catch (HttpException|ValidationException) {
                    $this->reason = self::RUNTIME_UNAVAILABLE;
                }

                continue;
            }
            // The runtime's body ended on its own.
            $this->reason = self::RUNTIME_UNAVAILABLE;
        }

        $position = $this->position ?? $this->openPosition;
        if (! in_array($this->reason, [self::RESET, self::CLIENT], true) && $position !== null) {
            $writer->event('closed', null, ['schema_version' => 'telemetry-stream-closed.v1', 'reason' => $this->reason, 'position' => $position]);
        }
        $this->sessions->close($session, $this->reason, $position);
    }

    /**
     * The internal request: the device set, and the position to continue from (the last
     * relayed reading, else the position the stream opened at; none for a fresh stream).
     *
     * @return array<string, string>
     */
    private function query(): array
    {
        $after = $this->position ?? $this->openPosition;

        return ['organization' => $this->organization->uuid, 'devices' => implode(',', $this->devices)]
            + ($after === null ? [] : ['after' => $after]);
    }

    /** Splits complete frames out of the runtime's bytes and relays each one. */
    private function onChunk(string $bytes): void
    {
        $this->buffer .= $bytes;
        while (($end = strpos($this->buffer, "\n\n")) !== false) {
            $frame = substr($this->buffer, 0, $end + 2);
            $this->buffer = substr($this->buffer, $end + 2);
            $this->relay($frame);
            if ($this->reason !== null) {
                return;
            }
        }
    }

    private function relay(string $frame): void
    {
        $event = null;
        $id = null;
        $data = null;
        foreach (explode("\n", $frame) as $line) {
            if (str_starts_with($line, 'event: ')) {
                $event = substr($line, 7);
            } elseif (str_starts_with($line, 'id: ')) {
                $id = substr($line, 4);
            } elseif (str_starts_with($line, 'data: ')) {
                $data = substr($line, 6);
            }
        }
        if ($event === 'open') {
            if ($this->openRelayed || $this->dropNextOpen) {
                $this->dropNextOpen = false;

                return;
            }
            $this->openRelayed = true;
            $decoded = is_string($data) ? json_decode($data, true) : null;
            $this->openPosition = is_array($decoded) && is_string($decoded['position'] ?? null) ? $decoded['position'] : $this->position;
        } elseif ($event === 'reading' && $id !== null) {
            $this->position = $id;
        } elseif ($event === 'reset') {
            $this->resetRelayed = true;
        }
        $this->writer->raw($frame);
        $this->lastWrite = CarbonImmutable::now();
        if (($this->clientGone)()) {
            $this->reason = self::CLIENT;
        }
    }

    /**
     * Polled between chunks and every idle tick: the stop conditions, the periodic
     * re-check and the relay's own keepalive.
     */
    private function shouldStop(IntegrationStreamSession $session): bool
    {
        if ($this->reason !== null) {
            return true;
        }
        $now = CarbonImmutable::now();
        if (($this->clientGone)()) {
            $this->reason = self::CLIENT;
        } elseif (($this->terminating)()) {
            $this->reason = self::SHUTDOWN;
        } elseif ($now->greaterThanOrEqualTo($this->deadline)) {
            $this->reason = self::LIFETIME;
        } elseif ($now->greaterThanOrEqualTo($this->nextCheck)) {
            $this->nextCheck = $now->addSeconds((int) config('integrations.stream_recheck_seconds'));
            $this->recheck($session);
        }
        if ($this->reason === null && $this->lastWrite->addSeconds((int) config('integrations.stream_keepalive_seconds'))->lessThanOrEqualTo($now)) {
            $this->writer->comment('keepalive');
            $this->lastWrite = $now;
            if (($this->clientGone)()) {
                $this->reason = self::CLIENT;
            }
        }

        return $this->reason !== null || $this->reopen;
    }

    /**
     * One read each of the application and the token, the session touch, and the device
     * set for a scope. A saved grant also deletes the token, so the grant revision is
     * judged before the token: the client learns the grant changed, not merely that its
     * credentials went.
     */
    private function recheck(IntegrationStreamSession $session): void
    {
        $application = IntegrationApplication::query()->whereKey($this->application->getKey())->first(['id', 'grant_revision', 'revoked_at']);
        if ($application === null || $application->revoked_at !== null) {
            $this->reason = self::CREDENTIALS_CHANGED;

            return;
        }
        if ((int) $application->grant_revision !== (int) $this->application->grant_revision) {
            $this->reason = self::GRANT_CHANGED;

            return;
        }
        $token = PersonalAccessToken::query()->whereKey($this->token->getKey())->first(['id', 'expires_at']);
        if ($token === null || $token->expires_at === null || $token->expires_at->isPast()) {
            $this->reason = self::CREDENTIALS_CHANGED;

            return;
        }
        $this->sessions->touch($session, $this->position);
        if ($this->grant->kind() !== ApplicationGrant::SITES) {
            return;
        }
        $resolved = $this->grant->resolveUuids();
        $devices = self::sorted($this->subset === null ? $resolved : array_values(array_intersect($this->subset, $resolved)));
        if ($devices !== $this->devices && $devices !== []) {
            $this->devices = $devices;
            $this->reopen = true;
        }
    }

    /**
     * @param  list<string>  $devices
     * @return list<string>
     */
    private static function sorted(array $devices): array
    {
        $devices = array_values(array_unique($devices));
        sort($devices, SORT_STRING);

        return $devices;
    }

    /** A SIGTERM handler where PHP offers one, so a stopping worker can say `shutdown`. */
    private static function terminationWatcher(): Closure
    {
        $stopping = false;
        if (function_exists('pcntl_async_signals') && function_exists('pcntl_signal') && defined('SIGTERM')) {
            pcntl_async_signals(true);
            pcntl_signal(SIGTERM, static function () use (&$stopping): void {
                $stopping = true;
            });
        }

        return static fn (): bool => $stopping;
    }
}
