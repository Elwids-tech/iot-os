<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Controllers;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\Invoice;
use App\Domain\Billing\Services\Payments;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * An owner's card and online payments (spec 029 US7). Both happen on Stripe's Checkout
 * pages, so these routes only hand back a page's address; card numbers never reach the
 * platform. An account the person does not own, or any of these while payments are off,
 * answers 404.
 */
final class OwnedPaymentController
{
    public function __construct(private readonly Payments $payments) {}

    /** A Stripe page to save a card, which then becomes the account's card for its invoices. */
    public function paymentMethodCheckout(Request $request, string $billingAccount): JsonResponse
    {
        $account = $this->account($request, $billingAccount);

        return response()->json(['data' => ['url' => $this->payments->checkoutForPaymentMethod($account)]]);
    }

    public function removePaymentMethod(Request $request, string $billingAccount): Response
    {
        /** @var User $user */
        $user = $request->user();
        $this->payments->removePaymentMethod($this->account($request, $billingAccount), $user);

        return response()->noContent();
    }

    /** A Stripe page to pay what is still owed on an issued invoice; 409 when nothing is. */
    public function invoiceCheckout(Request $request, string $billingAccount, string $invoice): JsonResponse
    {
        $found = $this->account($request, $billingAccount)->invoices()
            ->where('uuid', $invoice)
            ->where('status', Invoice::ISSUED)
            ->firstOrFail();

        return response()->json(['data' => ['url' => $this->payments->checkoutForInvoice($found)]]);
    }

    private function account(Request $request, string $uuid): BillingAccount
    {
        abort_unless(Payments::enabled(), 404);
        /** @var User $user */
        $user = $request->user();
        /** @var BillingAccount|null $account */
        $account = $user->ownedBillingAccounts()->where('billing_accounts.uuid', $uuid)->first();
        abort_if($account === null, 404);

        return $account;
    }
}
