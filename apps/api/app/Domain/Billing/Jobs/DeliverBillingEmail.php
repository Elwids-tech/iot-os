<?php

declare(strict_types=1);

namespace App\Domain\Billing\Jobs;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Shared\Models\User;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Support\Facades\Mail;

/**
 * Sends one billing email to one owner of the account (`Notices`). Ownership and a
 * verified address are checked again here, so someone removed as owner before the worker
 * runs gets nothing. One job per owner, so a retry never repeats another owner's email.
 */
final class DeliverBillingEmail implements ShouldQueue
{
    use Queueable;

    public int $tries = 5;

    public int $timeout = 30;

    public function __construct(
        public readonly int $userId,
        public readonly int $billingAccountId,
        public readonly Mailable $mail,
    ) {}

    /**
     * @return list<int>
     */
    public function backoff(): array
    {
        return [60, 300, 900];
    }

    public function handle(): void
    {
        $user = User::query()->find($this->userId);
        $account = BillingAccount::query()->find($this->billingAccountId);

        if ($user === null || $account === null || $user->email_verified_at === null || ! $account->owners()->whereKey($user->getKey())->exists()) {
            return;
        }

        Mail::to($user->email)->send($this->mail);
    }
}
