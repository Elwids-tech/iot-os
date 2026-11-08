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
 * notice is never queued twice or recorded without its emails. An account with no one to
 * email gets no notice. `billing:prune` removes rows after 13 months; every key carries its
 * month or subject, so a pruned key is never due again.
 */
final class Notices
{
    public function send(BillingAccount $account, string $kind, string $key, Mailable $mail): bool
    {
        return $this->deliver($account, $kind, $key, $mail, false);
    }

    /**
     * The same, to the account's billing contact as well (spec 029 FR-036): once per
     * address, so a contact who is also an owner gets one email.
     */
    public function sendWithContact(BillingAccount $account, string $kind, string $key, Mailable $mail): bool
    {
        return $this->deliver($account, $kind, $key, $mail, true);
    }

    private function deliver(BillingAccount $account, string $kind, string $key, Mailable $mail, bool $contact): bool
    {
        $emails = $account->owners()->pluck('users.email', 'users.id')->all();
        $owners = array_map('intval', array_keys($emails));
        $address = $contact ? $account->contact_email : null;

        if ($address !== null && in_array(mb_strtolower($address), array_map('mb_strtolower', $emails), true)) {
            $address = null;
        }

        if ($owners === [] && $address === null) {
            return false;
        }

        return DB::transaction(function () use ($account, $kind, $key, $mail, $owners, $address): bool {
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

            if ($address !== null) {
                DeliverBillingEmail::dispatch(null, (int) $account->getKey(), $mail, $address)->onConnection('alerts')->onQueue('alerts');
            }

            return true;
        });
    }
}
