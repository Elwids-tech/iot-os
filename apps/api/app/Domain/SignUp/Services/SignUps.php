<?php

declare(strict_types=1);

namespace App\Domain\SignUp\Services;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Authentication\Services\CompleteSignIn;
use App\Domain\Billing\Services\BillingAccounts;
use App\Domain\Billing\Services\OwnerOrganizations;
use App\Domain\Shared\Models\User;
use App\Domain\SignUp\Events\SignUpCompleted;
use App\Domain\SignUp\Events\SignUpsPaused;
use App\Domain\SignUp\Models\SignUp;
use App\Domain\SignUp\Notifications\SignUpAccountExists;
use App\Domain\SignUp\Notifications\SignUpConfirmation;
use App\Domain\SignUp\Notifications\SignUpWelcome;
use Carbon\CarbonImmutable;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Self sign-up (spec 035). A submission stores a waiting sign-up and emails a single-use
 * link; nothing else exists until the link is opened (research R2). Opening it creates
 * the person, a billing account they own and its first organization through the same
 * services administrators and owners use (research R5). Only the browser that submitted
 * is then signed in, once (research R3).
 */
final class SignUps
{
    /** The session key that ties a browser to the sign-up it submitted. */
    public const SESSION_KEY = 'sign_up.pending';

    public const LINK_HOURS = 24;

    public const RESEND_SECONDS = 60;

    /** How long after completion the waiting browser may still be signed in by it. */
    public const SIGN_IN_WINDOW_MINUTES = 60;

    public function __construct(
        private readonly SignUpSettings $settings,
        private readonly FormToken $formToken,
        private readonly BillingAccounts $billingAccounts,
        private readonly OwnerOrganizations $organizations,
        private readonly CompleteSignIn $completeSignIn,
    ) {}

    /**
     * @param  array{name: string, email: string, password: string, organization_name: string, form_token?: ?string, website?: ?string}  $input
     * @return array{state: string, email: string, resend_after: int}
     */
    public function start(array $input, Request $request): array
    {
        $email = Str::lower(trim($input['email']));
        $name = trim($input['name']);
        $organizationName = trim($input['organization_name']);

        // A person never fills the hidden field, and cannot type the form in 3 seconds (FR-041).
        $problem = filled($input['website'] ?? null) ? 'honeypot' : $this->formToken->problem($input['form_token'] ?? null);
        if ($problem !== null) {
            $this->refuse($name, $email, $organizationName, $problem, $request);

            throw ValidationException::withMessages(['form' => 'Something went wrong. Reload the page and try again.']);
        }

        $this->checkCeiling($name, $email, $organizationName, $request);

        // The same answer and the same hashing work whether or not the address has an
        // account, so the page never tells who has one (FR-014, SC-004).
        $hash = Hash::make($input['password']);
        $existing = User::query()->where('email', $email)->first();
        if ($existing !== null) {
            $existing->notify(new SignUpAccountExists);

            return ['state' => SignUp::WAITING, 'email' => $email, 'resend_after' => self::RESEND_SECONDS];
        }

        $values = [
            'name' => $name,
            'organization_name' => $organizationName,
            'password' => $hash,
            'ip_address' => $request->ip(),
            'user_agent' => Str::limit((string) $request->userAgent(), 250, ''),
        ];
        // A new submission for an address that is waiting replaces it (FR-015).
        $signUp = $this->waitingFor($email);
        if ($signUp === null) {
            try {
                $signUp = SignUp::query()->create([...$values, 'email' => $email, 'state' => SignUp::WAITING]);
            } catch (UniqueConstraintViolationException) {
                $signUp = $this->waitingFor($email) ?? throw ValidationException::withMessages(['email' => 'Try again in a moment.']);
            }
        }
        $signUp->fill($values);
        $this->sendLink($signUp);

        $request->session()->put(self::SESSION_KEY, $signUp->uuid);

        return ['state' => SignUp::WAITING, 'email' => $email, 'resend_after' => self::RESEND_SECONDS];
    }

    /** A new link for the browser's waiting sign-up; the earlier one stops working (FR-009). */
    public function resend(Request $request): SignUp
    {
        $signUp = $this->pending($request);
        abort_if($signUp === null || ! $signUp->isWaiting(), 404);

        $wait = $this->resendAfter($signUp);
        if ($wait > 0) {
            $this->fail(429, ['message' => "You can ask for another email in {$wait} seconds.", 'retry_after' => $wait], ['Retry-After' => (string) $wait]);
        }

        $this->sendLink($signUp);

        return $signUp;
    }

    /**
     * Opens a link (FR-010). Completes a waiting sign-up, then signs in this browser only
     * when it is the one that submitted (research R3).
     *
     * @return array{state: string, signed_in: bool, organization_uuid: string, email: string}
     */
    public function confirm(string $token, Request $request): array
    {
        $hash = hash('sha256', $token);
        $completedNow = false;

        $signUp = DB::transaction(function () use ($hash, &$completedNow): SignUp {
            $signUp = SignUp::query()->where('token_hash', $hash)->lockForUpdate()->first();
            abort_if($signUp === null, 404, 'This link is no longer valid.');

            if ($signUp->state === SignUp::REFUSED) {
                $this->fail(409, ['code' => 'account_exists', 'message' => 'An account with this email already exists. Sign in instead.', 'email' => $signUp->email]);
            }
            if ($signUp->state === SignUp::COMPLETED) {
                return $signUp;
            }
            if ($signUp->linkExpired()) {
                $this->fail(410, ['code' => 'expired', 'message' => 'This link has expired.', 'email' => $signUp->email]);
            }
            // An account appeared for the address since: a sign-up never attaches an
            // organization to an account it did not create (research R4).
            if (User::query()->where('email', $signUp->email)->exists()) {
                $signUp->forceFill(['state' => SignUp::REFUSED, 'refusal_reason' => 'account_exists', 'password' => null])->save();

                return $signUp;
            }

            $this->complete($signUp);
            $completedNow = true;

            return $signUp;
        });

        if ($signUp->state === SignUp::REFUSED) {
            $this->fail(409, ['code' => 'account_exists', 'message' => 'An account with this email already exists. Sign in instead.', 'email' => $signUp->email]);
        }

        $signedIn = $this->signInWaitingBrowser($signUp, $request);
        if (! $completedNow && ! $signedIn) {
            $this->fail(410, ['code' => 'used', 'message' => 'This link was already used. Sign in instead.', 'email' => $signUp->email]);
        }

        return [
            'state' => SignUp::COMPLETED,
            'signed_in' => $signedIn,
            'organization_uuid' => (string) $signUp->organization?->uuid,
            'email' => $signUp->email,
        ];
    }

    /**
     * What the waiting page polls (FR-011). Signs this browser in once its sign-up has
     * completed anywhere.
     *
     * @return array<string, mixed>
     */
    public function status(Request $request): array
    {
        $signUp = $this->pending($request);
        abort_if($signUp === null, 404);

        return match ($signUp->state) {
            SignUp::WAITING => [
                'state' => SignUp::WAITING,
                'email' => $signUp->email,
                'resend_after' => $this->resendAfter($signUp),
            ],
            SignUp::COMPLETED => [
                'state' => SignUp::COMPLETED,
                'signed_in' => $this->signInWaitingBrowser($signUp, $request),
                'organization_uuid' => (string) $signUp->organization?->uuid,
                'email' => $signUp->email,
            ],
            default => ['state' => SignUp::REFUSED, 'reason' => (string) $signUp->refusal_reason, 'email' => $signUp->email],
        };
    }

    /**
     * Sign-in with the password of a sign-up nobody confirmed yet (spec edge case): the
     * browser takes it over, so the page can send the link again.
     */
    public function claimUnconfirmed(string $email, string $password, Request $request): bool
    {
        $signUp = $this->waitingFor(Str::lower(trim($email)));
        if ($signUp === null || $signUp->password === null || ! Hash::check($password, $signUp->password)) {
            return false;
        }

        $request->session()->put(self::SESSION_KEY, $signUp->uuid);

        return true;
    }

    /** Seconds until the waiting sign-up may be sent again. */
    public function resendAfter(SignUp $signUp): int
    {
        if ($signUp->last_sent_at === null) {
            return 0;
        }

        return max(0, self::RESEND_SECONDS - (int) $signUp->last_sent_at->diffInSeconds(now()));
    }

    /**
     * Creates the person, their billing account and its first organization (research R5).
     * Runs inside the caller's transaction with the sign-up locked.
     */
    private function complete(SignUp $signUp): void
    {
        $user = new User;
        // `is_super_admin` is mass-assignable on User, so nothing from a request reaches fill().
        $user->forceFill([
            'name' => $signUp->name,
            'email' => $signUp->email,
            'password' => $signUp->password,
            'email_verified_at' => now(),
        ])->save();

        $account = $this->billingAccounts->create(['name' => $signUp->organization_name, 'contact_email' => $signUp->email], $user);
        $this->billingAccounts->addOwner($account, $user, $user);
        $organization = $this->organizations->create($user, $account->uuid, $signUp->organization_name, null, 'sign_up');

        $now = now();
        $signUp->forceFill([
            'state' => SignUp::COMPLETED,
            'password' => null,
            'confirmed_at' => $now,
            'completed_at' => $now,
            'user_id' => $user->getKey(),
            'organization_id' => $organization->getKey(),
            'billing_account_id' => $account->getKey(),
        ])->save();

        ActivityLog::record('sign_up.completed', $organization, $user, $organization, [
            'sign_up_uuid' => $signUp->uuid,
            'billing_account_uuid' => $account->uuid,
        ]);

        $user->notify(new SignUpWelcome($organization));
        SignUpCompleted::dispatch($signUp->getKey());
    }

    /**
     * Signs in the browser that submitted, once, within the window, and only a person with
     * no second step to ask for (research R3, FR-018). Anyone else signs in as usual.
     */
    private function signInWaitingBrowser(SignUp $signUp, Request $request): bool
    {
        if ($request->session()->get(self::SESSION_KEY) !== $signUp->uuid
            || $signUp->state !== SignUp::COMPLETED
            || $signUp->signed_in_at !== null
            || $signUp->completed_at === null
            || $signUp->completed_at->lt(now()->subMinutes(self::SIGN_IN_WINDOW_MINUTES))) {
            return false;
        }

        $user = $signUp->user;
        if ($user === null || $user->hasEnabledTwoFactorAuthentication() || $user->twoStepSatisfied() || $user->twoStepRequired()) {
            return false;
        }

        // Once, even when the poll and the link arrive together.
        $claimed = SignUp::query()->whereKey($signUp->getKey())->whereNull('signed_in_at')->update(['signed_in_at' => now()]);
        if ($claimed !== 1) {
            return false;
        }

        $request->session()->forget(self::SESSION_KEY);
        ($this->completeSignIn)($user, false, $request);

        return true;
    }

    private function sendLink(SignUp $signUp): void
    {
        $token = Str::random(40);
        $signUp->forceFill([
            'token_hash' => hash('sha256', $token),
            'token_expires_at' => now()->addHours(self::LINK_HOURS),
            'sends' => $signUp->sends + 1,
            'last_sent_at' => now(),
        ])->save();

        Notification::route('mail', [$signUp->email => $signUp->name])->notify(new SignUpConfirmation($signUp->name, $token));
    }

    /** The daily ceiling (FR-042): sign-ups started today (UTC), waiting or completed. */
    private function checkCeiling(string $name, string $email, string $organizationName, Request $request): void
    {
        $limit = $this->settings->get()['daily_limit'];
        $today = CarbonImmutable::now('UTC')->startOfDay();
        $started = SignUp::query()
            ->whereIn('state', [SignUp::WAITING, SignUp::COMPLETED])
            ->where('created_at', '>=', $today)
            ->count();

        if ($started < $limit) {
            return;
        }

        $this->refuse($name, $email, $organizationName, 'paused', $request);
        if (Cache::add('sign-ups-paused:'.$today->toDateString(), true, $today->addDay())) {
            SignUpsPaused::dispatch($limit);
        }

        $retryAfter = (int) now()->diffInSeconds($today->addDay(), true);
        $this->fail(503, [
            'code' => 'sign_up_paused',
            'message' => 'We have reached today\'s limit for new sign-ups. Please try again tomorrow.',
            'retry_after' => $retryAfter,
        ], ['Retry-After' => (string) $retryAfter]);
    }

    /** Refusals are listed for abuse review, with no password (FR-028). */
    private function refuse(string $name, string $email, string $organizationName, string $reason, Request $request): void
    {
        SignUp::query()->create([
            'name' => Str::limit($name, 120, ''),
            'email' => Str::limit($email, 255, ''),
            'organization_name' => Str::limit($organizationName, 80, ''),
            'state' => SignUp::REFUSED,
            'refusal_reason' => $reason,
            'ip_address' => $request->ip(),
            'user_agent' => Str::limit((string) $request->userAgent(), 250, ''),
        ]);
    }

    private function waitingFor(string $email): ?SignUp
    {
        return SignUp::query()->where('email', $email)->where('state', SignUp::WAITING)->first();
    }

    private function pending(Request $request): ?SignUp
    {
        $uuid = $request->session()->get(self::SESSION_KEY);

        return is_string($uuid) && Str::isUuid($uuid) ? SignUp::query()->where('uuid', $uuid)->first() : null;
    }

    /**
     * @param  array<string, mixed>  $body
     * @param  array<string, string>  $headers
     */
    private function fail(int $status, array $body, array $headers = []): never
    {
        throw new HttpResponseException(response()->json($body, $status, $headers));
    }
}
