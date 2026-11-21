<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Http\Controllers;

use App\Domain\Authentication\Http\Requests\TwoStepChallengeRequest;
use App\Domain\Authentication\Http\Resources\AuthenticatedUserResource;
use App\Domain\Authentication\Notifications\SecurityChanged;
use App\Domain\Authentication\Services\CompleteSignIn;
use App\Domain\Authentication\Services\PasskeyAvailability;
use App\Domain\Authentication\Services\SecurityAudit;
use App\Domain\Shared\Models\User;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Laravel\Fortify\Contracts\TwoFactorAuthenticationProvider;
use Laravel\Fortify\Fortify;

/**
 * The second step of sign-in (spec 034, FR-007 to FR-011). A right password for a
 * person with two-step on leaves only a pending sign-in in the session: who, whether to
 * keep the browser signed in, when it expires and how many wrong codes so far. No
 * session exists until a valid code or an unused recovery code arrives here.
 */
final class TwoStepChallengeController
{
    public const SESSION_KEY = 'two_step.pending';

    public const EXPIRES_IN = 300;

    public const ATTEMPTS = 5;

    public const ELSEWHERE = 'second_step_elsewhere';

    public function __construct(
        private readonly CompleteSignIn $complete,
        private readonly SecurityAudit $audit,
        private readonly TwoFactorAuthenticationProvider $codes,
    ) {}

    /**
     * Start a pending sign-in, replacing any earlier one in this browser.
     */
    public static function begin(Request $request, User $user, bool $remember): JsonResponse
    {
        // Codes only for a person with the authenticator app; a required person with only a
        // passkey is asked for the passkey alone (FR-022).
        $methods = $user->hasEnabledTwoFactorAuthentication() ? ['code', 'recovery_code'] : [];
        // A passkey also finishes the sign-in, and counts as both steps (FR-017).
        // Only a passkey made on this domain can answer here (spec 036, FR-026).
        if (app(PasskeyAvailability::class)->available() && $user->passkeysHere()->exists()) {
            $methods[] = 'passkey';
        }
        // Their only second step is a passkey from another domain. The password alone
        // never starts their session (FR-027), so there is nothing to offer here.
        if ($methods === []) {
            return response()->json([
                'code' => self::ELSEWHERE,
                'message' => 'Your passkey belongs to another address, so it cannot finish signing in here. Sign in where you made it and add an authenticator app, or ask an administrator to reset your two-step sign-in.',
            ], 403);
        }

        $request->session()->put(self::SESSION_KEY, [
            'user_id' => $user->getKey(),
            // The login limiter counts code attempts against the same account and address.
            'email' => $user->email,
            'remember' => $remember,
            'methods' => $methods,
            'expires_at' => now()->addSeconds(self::EXPIRES_IN)->getTimestamp(),
            'attempts' => 0,
        ]);

        return response()->json([
            'two_step_required' => true,
            'expires_in' => self::EXPIRES_IN,
            'methods' => $methods,
        ], 202);
    }

    public function __invoke(TwoStepChallengeRequest $request): AuthenticatedUserResource
    {
        $pending = $request->session()->get(self::SESSION_KEY);
        if (! is_array($pending) || (int) ($pending['expires_at'] ?? 0) < now()->getTimestamp()) {
            $this->startAgain($request);
        }

        $user = User::query()->find($pending['user_id'] ?? null);
        if (! $user instanceof User || ! $user->hasEnabledTwoFactorAuthentication()) {
            $this->startAgain($request);
        }

        $recoveryCode = $request->validated('recovery_code');
        // One check at a time per person, so a code or recovery code sent twice at once
        // still signs in only once (SC-007).
        $remaining = Cache::lock('two_step.challenge.'.$user->getKey(), 10)->block(5, fn (): int|false|null => is_string($recoveryCode)
            ? $this->useRecoveryCode($user, $recoveryCode)
            : ($this->codes->verify(Fortify::currentEncrypter()->decrypt($user->two_factor_secret), (string) $request->validated('code')) ? null : false));

        if ($remaining === false) {
            $attempts = (int) ($pending['attempts'] ?? 0) + 1;
            $left = self::ATTEMPTS - $attempts;
            if ($left <= 0) {
                $this->startAgain($request);
            }
            $request->session()->put(self::SESSION_KEY.'.attempts', $attempts);

            $field = is_string($recoveryCode) ? 'recovery_code' : 'code';
            $message = is_string($recoveryCode) ? 'That recovery code is not valid.' : 'That code is not valid.';

            throw new HttpResponseException(response()->json([
                'message' => $message,
                'errors' => [$field => [$message]],
                'attempts_left' => $left,
            ], 422));
        }

        $request->session()->forget(self::SESSION_KEY);
        ($this->complete)($user, (bool) ($pending['remember'] ?? false), $request);

        $resource = AuthenticatedUserResource::make($user->load('organizations'));

        return is_int($remaining) ? $resource->additional(['recovery_codes_remaining' => $remaining]) : $resource;
    }

    /**
     * Use up a recovery code. Returns how many remain, or false when it is not one.
     */
    private function useRecoveryCode(User $user, string $code): int|false
    {
        return DB::transaction(function () use ($user, $code): int|false {
            /** @var User $locked */
            $locked = User::query()->lockForUpdate()->findOrFail($user->getKey());
            if ($locked->two_factor_recovery_codes === null) {
                return false;
            }
            $code = trim($code);
            $match = collect($locked->recoveryCodes() ?? [])->first(fn (mixed $stored): bool => is_string($stored) && hash_equals($stored, $code));
            if (! is_string($match)) {
                return false;
            }

            $locked->replaceRecoveryCode($match);
            $remaining = $locked->remainingRecoveryCodes();
            $this->audit->record($locked, SecurityChanged::RECOVERY_CODE_USED, $locked, ['remaining' => $remaining]);
            $user->setRawAttributes($locked->getAttributes(), true);

            return $remaining;
        });
    }

    private function startAgain(Request $request): never
    {
        $request->session()->forget(self::SESSION_KEY);

        throw ValidationException::withMessages(['pending' => ['Start again with your password.']]);
    }
}
