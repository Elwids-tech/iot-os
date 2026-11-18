<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Http\Middleware;

use App\Domain\Authentication\Services\PasskeyAvailability;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Passkey routes answer `404` where passkeys cannot be used (spec 034, FR-018): a
 * deployment whose front ends are not served over HTTPS.
 */
final class EnsurePasskeysAvailable
{
    public function __construct(private readonly PasskeyAvailability $availability) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        abort_unless($this->availability->available(), 404);

        return $next($request);
    }
}
