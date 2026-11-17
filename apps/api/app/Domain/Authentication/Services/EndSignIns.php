<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Services;

use App\Domain\Authentication\Models\KeptSignIn;
use App\Domain\Notifications\Models\PushDevice;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

/**
 * Ends a person's sign-ins: their database sessions, their live kept sign-ins (spec 033)
 * and the push devices those carried. Agent connections are not touched; callers that
 * also revoke those (password reset) do so themselves.
 */
final class EndSignIns
{
    /**
     * Every sign-in of the person. The current request is signed out only when it is
     * that person's: an administrator running a reset stays signed in.
     */
    public function everywhere(User $user, string $reason, ?Request $request = null): void
    {
        KeptSignIn::query()->where('user_id', $user->getKey())->live()
            ->update(['ended_at' => now(), 'end_reason' => $reason]);
        PushDevice::query()->where('user_id', $user->getKey())->delete();
        $this->sessions($user)?->delete();

        if (Auth::guard('web')->id() === $user->getKey()) {
            Auth::guard('web')->logout();
            if ($request?->hasSession()) {
                $request->session()->invalidate();
                $request->session()->regenerateToken();
            }
        }
    }

    /**
     * Every sign-in of the person except the browser making the request (spec 034,
     * FR-013): its session and its kept sign-in stay.
     */
    public function elsewhere(User $user, Request $request, string $reason): void
    {
        $sessionId = $request->hasSession() ? $request->session()->getId() : null;
        $keptId = $request->hasSession() ? $request->session()->get(KeptSignInCookie::SESSION_KEY) : null;
        $keptId = $keptId === null ? null : (int) $keptId;

        KeptSignIn::query()->where('user_id', $user->getKey())->live()
            ->when($keptId !== null, fn ($query) => $query->whereKeyNot($keptId))
            ->update(['ended_at' => now(), 'end_reason' => $reason]);
        // session_id is encrypted, so the current browser's devices are picked out here.
        PushDevice::query()->where('user_id', $user->getKey())->get()
            ->reject(fn (PushDevice $device): bool => ($sessionId !== null && $device->session_id === $sessionId)
                || ($keptId !== null && $device->kept_sign_in_id === $keptId))
            ->each->delete();
        $this->sessions($user)?->when($sessionId !== null, fn ($query) => $query->where('id', '!=', $sessionId))->delete();
    }

    private function sessions(User $user): ?Builder
    {
        if (config('session.driver') !== 'database') {
            return null;
        }

        return DB::connection(config('session.connection'))->table(config('session.table', 'sessions'))
            ->where('user_id', $user->getKey());
    }
}
