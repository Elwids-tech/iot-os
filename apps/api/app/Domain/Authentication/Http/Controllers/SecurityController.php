<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Http\Controllers;

use App\Domain\Authentication\Http\Resources\PasskeyResource;
use App\Domain\Authentication\Services\PasskeyAvailability;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The signed-in person's security settings (spec 034, FR-029). Never returns a secret, a
 * recovery code or credential material: only whether two-step is on, how many codes
 * remain, and the passkeys by name.
 */
final class SecurityController
{
    public function show(Request $request, PasskeyAvailability $availability): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        $enabled = $user->hasEnabledTwoFactorAuthentication();

        return response()->json(['data' => [
            'two_step' => [
                'enabled' => $enabled,
                'confirmed_at' => $enabled ? $user->two_factor_confirmed_at?->toIso8601ZuluString() : null,
                'recovery_codes_remaining' => $enabled ? $user->remainingRecoveryCodes() : 0,
                // Required two-step arrives with spec 034's required two-step pull request.
                'required' => false,
                'required_by' => [],
                'satisfied' => $user->twoStepSatisfied(),
            ],
            'passkeys' => [
                'available' => $availability->available(),
                'unavailable_reason' => $availability->unavailableReason(),
                'items' => PasskeyResource::collection($user->passkeys()->orderBy('created_at')->orderBy('id')->get())->resolve($request),
            ],
        ]]);
    }
}
