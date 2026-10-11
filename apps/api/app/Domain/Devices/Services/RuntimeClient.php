<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\ValidationException;

final class RuntimeClient
{
    /**
     * Seconds to wait for range reads (history, state history, consumption):
     * longer than the runtime's own 25 s limit for them, so its explanation
     * arrives instead of a dropped connection.
     */
    public const RANGE_TIMEOUT = 30;

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
}
