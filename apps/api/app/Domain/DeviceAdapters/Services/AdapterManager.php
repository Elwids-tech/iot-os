<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Services;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

final class AdapterManager
{
    public function request(string $path, array $body): array
    {
        abort_unless(filled(config('adapters.manager_token')), 503, 'The device adapter runtime is not configured.');
        try {
            $response = Http::withToken(config('adapters.manager_token'))->connectTimeout(5)->timeout(90)->post(rtrim(config('adapters.manager_url'), '/').$path, $body);
            abort_unless($response->successful(), $response->status() === 422 ? 422 : 503, $response->status() === 422 ? 'The runtime rejected this adapter configuration.' : 'The adapter runtime could not complete this operation.');

            return $response->json() ?? [];
        } catch (ConnectionException) {
            abort(503, 'The adapter runtime is unavailable. Your saved draft is preserved.');
        }
    }
}
