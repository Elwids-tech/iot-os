<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Http\Controllers;

use App\Domain\Authentication\Http\Requests\LoginRequest;
use App\Domain\Authentication\Http\Resources\AuthenticatedUserResource;
use App\Domain\Authentication\Models\KeptSignIn;
use App\Domain\Authentication\Services\KeptSignInCookie;
use App\Domain\Notifications\Models\PushDevice;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cookie;
use Illuminate\Validation\ValidationException;

final class SessionController
{
    public function __construct(private readonly KeptSignInCookie $kept) {}

    public function store(LoginRequest $request): AuthenticatedUserResource
    {
        if (! Auth::guard('web')->attempt($request->safe()->only(['email', 'password']))) {
            throw ValidationException::withMessages([
                'email' => __('auth.failed'),
            ]);
        }

        // A new sign-in replaces whatever this browser kept before.
        $this->kept->record($request)?->end(KeptSignIn::SIGNED_OUT);
        $request->session()->forget(KeptSignInCookie::SESSION_KEY);
        $request->session()->regenerate();

        /** @var User $user */
        $user = Auth::guard('web')->user();

        if ($request->boolean('remember')) {
            [$record, $secret] = KeptSignIn::issue($user, $this->kept->label($request->userAgent()));
            $request->session()->put(KeptSignInCookie::SESSION_KEY, $record->getKey());
            Cookie::queue($this->kept->make($record, $secret));
        } elseif ($this->kept->present($request)) {
            Cookie::queue($this->kept->forget());
        }

        return AuthenticatedUserResource::make(
            $user->load('organizations'),
        );
    }

    public function show(Request $request): AuthenticatedUserResource
    {
        /** @var User $user */
        $user = $request->user();

        return AuthenticatedUserResource::make(
            $user->loadMissing('organizations'),
        );
    }

    public function destroy(Request $request): JsonResponse
    {
        // Ends only this browser's kept sign-in; other devices stay signed in.
        $keptId = $request->session()->get(KeptSignInCookie::SESSION_KEY);
        if ($keptId !== null) {
            KeptSignIn::query()->find($keptId)?->end(KeptSignIn::SIGNED_OUT);
        }
        if ($this->kept->present($request)) {
            $this->kept->record($request)?->end(KeptSignIn::SIGNED_OUT);
        }
        if ($keptId !== null || $this->kept->present($request)) {
            Cookie::queue($this->kept->forget());
        }
        // This browser stops getting pushes (spec 033, FR-028); the person's other devices keep them.
        $sessionId = $request->session()->getId();
        PushDevice::query()->where('user_id', $request->user()?->getKey())->get()
            ->filter(fn (PushDevice $device): bool => $device->session_id === $sessionId || ($keptId !== null && $device->kept_sign_in_id === (int) $keptId))
            ->each->delete();

        Auth::guard('web')->logout();
        Auth::guard('sanctum')->forgetUser();

        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->json([
            'message' => 'Logged out.',
        ]);
    }
}
