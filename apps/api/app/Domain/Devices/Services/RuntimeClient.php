<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\ValidationException;
use Psr\Http\Message\StreamInterface;

final class RuntimeClient
{
    /**
     * Seconds to wait for range reads (history, state history, consumption):
     * longer than the runtime's own 25 s limit for them, so its explanation
     * arrives instead of a dropped connection.
     */
    public const RANGE_TIMEOUT = 30;

    /**
     * Seconds a quiet internal stream waits before `stream()` polls its stop condition
     * again (spec 030). The request itself has no overall timeout.
     */
    public const STREAM_TICK_SECONDS = 1;

    public function request(string $method, string $path, array $data = [], int $timeout = 10): array
    {
        abort_unless(config('devices.runtime_token'), 503, 'The device runtime is not configured.');
        try {
            $response = Http::baseUrl(rtrim(config('devices.runtime_url'), '/'))
                ->withToken(config('devices.runtime_token'))->acceptJson()->timeout($timeout)
                ->send($method, $path, [strtoupper($method) === 'GET' ? 'query' : 'json' => $data]);
        } catch (ConnectionException) {
            abort(503, 'The device runtime is unavailable.');
        }
        if ($response->status() === 422) {
            throw ValidationException::withMessages(['runtime' => $response->json('message', 'The runtime rejected this configuration.')]);
        }
        // A range read cut off at the runtime's limit says so, so people can choose a shorter range.
        abort_if($response->status() === 504, 504, $response->json('message', 'This range took too long to load. Choose a shorter range.'));
        abort_unless($response->successful(), 503, 'The device runtime could not complete this request.');

        return $response->json() ?? [];
    }

    /**
     * Opens an internal server-sent event stream and hands every chunk of its body to
     * `$onChunk` until the body ends or `$shouldStop()` is true (spec 030, research R2):
     * `openStream()` followed by `readStream()`.
     */
    public function stream(string $path, array $query, callable $onChunk, callable $shouldStop): void
    {
        $this->readStream($this->openStream($path, $query), $onChunk, $shouldStop);
    }

    /**
     * Opens the internal stream and returns its body once the runtime has answered. The
     * request has no overall timeout. A refused connection and a non-2xx answer are
     * mapped as `request()` maps them, so a relay can refuse its own client before it
     * has sent a byte.
     */
    public function openStream(string $path, array $query): StreamInterface
    {
        abort_unless(config('devices.runtime_token'), 503, 'The device runtime is not configured.');
        try {
            /** @var Response $response */
            $response = Http::baseUrl(rtrim(config('devices.runtime_url'), '/'))
                ->withToken(config('devices.runtime_token'))->accept('text/event-stream')
                ->timeout(0)->connectTimeout(5)
                ->withOptions(['stream' => true, 'read_timeout' => self::STREAM_TICK_SECONDS])
                ->get($path, $query);
        } catch (ConnectionException) {
            abort(503, 'The device runtime is unavailable.');
        }
        if ($response->status() === 422) {
            throw ValidationException::withMessages(['runtime' => $response->json('message', 'The runtime rejected this request.')]);
        }
        abort_unless($response->successful(), 503, 'The device runtime could not complete this request.');

        return $response->toPsrResponse()->getBody();
    }

    /**
     * Reads a stream body in one-second idle ticks so `$shouldStop()` is polled while
     * the runtime is quiet. Returns when the body ends or fails mid-stream (the caller
     * treats either as the runtime going away) or when `$shouldStop()` is true.
     */
    public function readStream(StreamInterface $body, callable $onChunk, callable $shouldStop): void
    {
        while (! $shouldStop()) {
            try {
                $chunk = $body->read(8192);
            } catch (\RuntimeException) {
                // A read that timed out is a quiet tick; anything else is the runtime going away.
                if ($body->getMetadata('timed_out') === true) {
                    continue;
                }

                return;
            }
            if ($chunk !== '') {
                $onChunk($chunk);
            } elseif ($body->eof()) {
                return;
            }
        }
    }
}
