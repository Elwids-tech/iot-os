<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\ValidationException;

final class RuntimeClient
{
    public function request(string $method, string $path, array $data = []): array
    {
        abort_unless(config('devices.runtime_token'), 503, 'The device runtime is not configured.');
        try {
            $response = Http::baseUrl(rtrim(config('devices.runtime_url'), '/'))
                ->withToken(config('devices.runtime_token'))->acceptJson()->timeout(10)
                ->send($method, $path, [strtoupper($method) === 'GET' ? 'query' : 'json' => $data]);
        } catch (ConnectionException) {
            abort(503, 'The device runtime is unavailable.');
        }
        if ($response->status() === 422) {
            throw ValidationException::withMessages(['runtime' => $response->json('message', 'The runtime rejected this configuration.')]);
        }
        abort_unless($response->successful(), 503, 'The device runtime could not complete this request.');

        return $response->json() ?? [];
    }
}
