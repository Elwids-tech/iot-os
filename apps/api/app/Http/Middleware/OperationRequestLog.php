<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

final class OperationRequestLog
{
    public function handle(Request $request, Closure $next)
    {
        if (! config('deployment.ops_enabled')) {
            return $next($request);
        }
        $started = microtime(true);
        $request->attributes->set('ops_started', $started);
        // Do not trust caller-supplied correlation IDs or log paths, queries or bodies.
        $id = (string) Str::uuid();
        Log::withContext(['request_id' => $id, 'service' => 'api']);
        $response = $next($request);
        if (! $request->is('internal/*', 'health/*', 'up')) {
            Log::info('http_request', ['method' => $request->method(), 'status' => $response->getStatusCode(), 'duration_seconds' => round(microtime(true) - $started, 4)]);
        }
        $response->headers->set('X-Request-ID', $id);

        return $response;
    }

    public function terminate(Request $request, $response): void
    {
        $started = $request->attributes->get('ops_started');
        if (! $started || $request->is('internal/*', 'health/*', 'up')) {
            return;
        }
        try {
            $key = ['minute' => intdiv(time(), 60) * 60, 'status_class' => intdiv($response->getStatusCode(), 100)];
            DB::table('operation_http_buckets')->insertOrIgnore($key);
            DB::table('operation_http_buckets')->where($key)->incrementEach(['requests' => 1, 'duration_seconds' => max(0, microtime(true) - $started)]);
        } catch (\Throwable) {
            // An observability failure must not change an already-sent response.
            Log::warning('HTTP metric recording unavailable', ['service' => 'api']);
        }
    }
}
