<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Http\Controllers;

use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The signed-in person's security settings (spec 034, FR-029). Never returns a secret or
 * a recovery code: only whether two-step is on and how many codes remain.
 */
final class SecurityController
{
    public function show(Request $request): JsonResponse
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
        ]]);
    }
}
