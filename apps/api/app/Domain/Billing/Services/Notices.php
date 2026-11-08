<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

use App\Domain\Billing\Jobs\DeliverBillingEmail;
use App\Domain\Billing\Models\BillingAccount;
use Illuminate\Mail\Mailable;
use Illuminate\Support\Facades\DB;

/**
 * Billing emails, each sent once per account, kind and key (data model: `billing_notices`).
 * The ledger row goes in first, and the owners' emails are queued in the same transaction
 * only when it was inserted, on the database queue the alert and ticket emails use, so a
 * notice is never queued twice or recorded without its emails. An account with no owners
 * gets no notice. `billing:prune` removes rows after 13 months; every key carries its
 * month or subject, so a pruned key is never due again.
 */
final class Notices
{
    public function send(BillingAccount $account, string $kind, string $key, Mailable $mail): bool
    {
        $owners = $account->owners()->pluck('users.id')->map(fn ($id): int => (int) $id)->all();

        if ($owners === []) {
            return false;
        }

        return DB::transaction(function () use ($account, $kind, $key, $mail, $owners): bool {
            $inserted = DB::table('billing_notices')->insertOrIgnore([
                'billing_account_id' => $account->getKey(),
                'kind' => $kind,
                'key' => $key,
                'sent_at' => now(),
            ]);

            if ($inserted === 0) {
                return false;
            }

            foreach ($owners as $owner) {
                DeliverBillingEmail::dispatch($owner, (int) $account->getKey(), $mail)->onConnection('alerts')->onQueue('alerts');
            }

            return true;
        });
    }
}
