<?php

declare(strict_types=1);

namespace App\Domain\Authorization\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class RequireIdempotencyKey
{
    public function handle(Request $request, Closure $next): Response
    {
        $key = $request->header('Idempotency-Key');
        abort_unless(is_string($key) && strlen($key) >= 8 && strlen($key) <= 255, 400, 'A valid Idempotency-Key header is required.');

        $request->attributes->set('idempotency_key', $key);

        return $next($request);
    }
}
