<?php

declare(strict_types=1);

namespace App\Domain\SignUp\Http\Controllers;

use App\Domain\SignUp\Http\Requests\StartSignUpRequest;
use App\Domain\SignUp\Services\FormToken;
use App\Domain\SignUp\Services\SignUps;
use App\Domain\SignUp\Services\SignUpSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rules\Password;

/**
 * The public sign-up routes (spec 035, contracts/sign-up-api.md). Every route touches
 * only the sign-up this browser submitted, or the one a link's token names.
 */
final class SignUpController
{
    public function __construct(private readonly SignUps $signUps) {}

    /** What the sign-up page needs before showing the form. */
    public function show(SignUpSettings $settings, FormToken $formToken): JsonResponse
    {
        $current = $settings->get();

        return response()->json([
            'open' => $current['open'],
            'free_beta' => $current['free_beta'],
            'form_token' => $current['open'] ? $formToken->issue() : null,
            'password_min' => (int) Password::defaults()->appliedRules()['min'],
        ]);
    }

    public function store(StartSignUpRequest $request): JsonResponse
    {
        /** @var array{name: string, email: string, password: string, organization_name: string, form_token?: ?string, website?: ?string} $input */
        $input = $request->validated();

        return response()->json($this->signUps->start($input, $request), 202);
    }

    public function status(Request $request): JsonResponse
    {
        return response()->json($this->signUps->status($request));
    }

    public function resend(Request $request): JsonResponse
    {
        $signUp = $this->signUps->resend($request);

        return response()->json([
            'state' => $signUp->state,
            'email' => $signUp->email,
            'resend_after' => $this->signUps->resendAfter($signUp),
        ], 202);
    }

    public function confirm(Request $request): JsonResponse
    {
        $token = $request->validate(['token' => ['required', 'string', 'max:128']])['token'];

        return response()->json($this->signUps->confirm((string) $token, $request));
    }
}
