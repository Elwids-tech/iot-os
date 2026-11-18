<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Http\Controllers;

use App\Domain\Authentication\Models\KeptSignIn;
use App\Domain\Authentication\Notifications\SecurityChanged;
use App\Domain\Authentication\Services\EndSignIns;
use App\Domain\Authentication\Services\SecurityAudit;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Laravel\Fortify\Actions\ConfirmTwoFactorAuthentication;
use Laravel\Fortify\Actions\DisableTwoFactorAuthentication;
use Laravel\Fortify\Actions\EnableTwoFactorAuthentication;
use Laravel\Fortify\Actions\GenerateNewRecoveryCodes;
use Laravel\Fortify\Fortify;

/**
 * A person's own two-step sign-in (spec 034, FR-001 to FR-006, FR-013): set up, confirm,
 * new recovery codes, turn off. Fortify's actions do the work behind our routes.
 * Recovery codes appear only in the response that issues them.
 */
final class TwoStepController
{
    public function __construct(
        private readonly EndSignIns $endSignIns,
        private readonly SecurityAudit $audit,
    ) {}

    /**
     * Start (or restart) setup: a new secret replaces any unconfirmed one (FR-002).
     */
    public function store(Request $request, EnableTwoFactorAuthentication $enable): JsonResponse
    {
        $user = $this->person($request);
        if ($user->hasEnabledTwoFactorAuthentication()) {
            return $this->conflict('two_step_already_on', 'Two-step sign-in is already on.');
        }

        $enable($user, true);
        $secret = Fortify::currentEncrypter()->decrypt($user->two_factor_secret);

        return response()->json([
            'qr_svg' => $user->twoFactorQrCodeSvg(),
            'setup_key' => trim(chunk_split($secret, 4, ' ')),
            'otpauth_url' => $user->twoFactorQrCodeUrl(),
        ]);
    }

    /**
     * Confirm setup with a code. Two-step is on from here, and every other sign-in of the
     * person ends (FR-013).
     */
    public function confirm(Request $request, ConfirmTwoFactorAuthentication $confirm): JsonResponse
    {
        $validated = $request->validate(['code' => ['required', 'string', 'digits:6']]);
        $user = $this->person($request);
        if ($user->hasEnabledTwoFactorAuthentication()) {
            return $this->conflict('two_step_already_on', 'Two-step sign-in is already on.');
        }

        DB::transaction(function () use ($confirm, $user, $validated, $request): void {
            $confirm($user, $validated['code']);
            $this->endSignIns->elsewhere($user, $request, KeptSignIn::TWO_STEP_CHANGED);
            $this->audit->record($user, SecurityChanged::TWO_STEP_ENABLED, $user);
        });

        return response()->json(['recovery_codes' => $user->recoveryCodes()]);
    }

    public function recoveryCodes(Request $request, GenerateNewRecoveryCodes $generate): JsonResponse
    {
        $user = $this->person($request);
        if (! $user->hasEnabledTwoFactorAuthentication()) {
            return $this->conflict('two_step_off', 'Turn on two-step sign-in first.');
        }

        DB::transaction(function () use ($generate, $user, $request): void {
            $generate($user);
            $this->endSignIns->elsewhere($user, $request, KeptSignIn::TWO_STEP_CHANGED);
            $this->audit->record($user, SecurityChanged::RECOVERY_CODES_REGENERATED, $user);
        });

        return response()->json(['recovery_codes' => $user->recoveryCodes()]);
    }

    public function destroy(Request $request, DisableTwoFactorAuthentication $disable): Response|JsonResponse
    {
        $user = $this->person($request);
        $wasOn = $user->hasEnabledTwoFactorAuthentication();
        if ($wasOn && $user->twoStepRequired()) {
            // FR-023: someone requires it, so it stays on. An unconfirmed setup can still be discarded.
            return $this->conflict('two_step_required', 'Two-step sign-in is required for your account, so it cannot be turned off.');
        }

        DB::transaction(function () use ($disable, $user, $request, $wasOn): void {
            // An unconfirmed setup is simply discarded; only turning off what was on is news.
            $disable($user);
            if ($wasOn) {
                $this->endSignIns->elsewhere($user, $request, KeptSignIn::TWO_STEP_CHANGED);
                $this->audit->record($user, SecurityChanged::TWO_STEP_DISABLED, $user);
            }
        });

        return response()->noContent();
    }

    private function person(Request $request): User
    {
        /** @var User */
        return $request->user();
    }

    private function conflict(string $code, string $message): JsonResponse
    {
        return response()->json(['code' => $code, 'message' => $message], 409);
    }
}
