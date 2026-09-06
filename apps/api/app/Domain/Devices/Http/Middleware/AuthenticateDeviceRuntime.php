<?php

declare(strict_types=1);

namespace App\Domain\Devices\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

final class AuthenticateDeviceRuntime
{
    public function handle(Request $request, Closure $next)
    {
        $token = config('devices.runtime_token');
        abort_unless(is_string($token) && strlen($token) >= 32 && hash_equals($token, (string) $request->bearerToken()), 401);

        return $next($request);
    }
}
