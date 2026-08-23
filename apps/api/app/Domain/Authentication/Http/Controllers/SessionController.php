<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Http\Controllers;

use App\Domain\Authentication\Http\Requests\LoginRequest;
use App\Domain\Authentication\Http\Resources\AuthenticatedUserResource;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;

final class SessionController
{
    public function store(LoginRequest $request): AuthenticatedUserResource
    {
        if (! Auth::guard('web')->attempt($request->validated())) {
            throw ValidationException::withMessages([
                'email' => __('auth.failed'),
            ]);
        }

        $request->session()->regenerate();

        /** @var User $user */
        $user = Auth::guard('web')->user();

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
        Auth::guard('web')->logout();
        Auth::guard('sanctum')->forgetUser();

        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->json([
            'message' => 'Logged out.',
        ]);
    }
}
